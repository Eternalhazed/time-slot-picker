(function attachTimeUtils(global) {
  "use strict";

  const ZONE_LABELS = {
    "America/New_York": "ET",
    "America/Chicago": "CT",
    "America/Denver": "MT",
    "America/Los_Angeles": "PT",
    UTC: "UTC",
    GMT: "GMT",
    "Europe/London": "GMT",
    "Europe/Paris": "CET",
    "Asia/Tokyo": "JST"
  };

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function toTotalMinutes(time) {
    return Number(time.totalMinutes ?? time.hour * 60 + time.minute);
  }

  function fromTotalMinutes(totalMinutes) {
    const clamped = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
    return {
      hour: Math.floor(clamped / 60),
      minute: clamped % 60,
      totalMinutes: clamped
    };
  }

  function snapToIncrement(time, incrementMinutes) {
    const total = toTotalMinutes(time);
    const snapped = Math.round(total / incrementMinutes) * incrementMinutes;
    return fromTotalMinutes(snapped);
  }

  function clientPointToTime(clientY, calibration) {
    if (!calibration || !Number.isFinite(calibration.pixelsPerHour) || calibration.pixelsPerHour <= 0) {
      return null;
    }

    const scrollTop = Number(calibration.scrollTop || 0);
    const gridRectTop = Number(calibration.gridRectTop || 0);
    const gridStartHour = Number(calibration.gridStartHour || 0);
    const hours = gridStartHour + (clientY - gridRectTop + scrollTop) / calibration.pixelsPerHour;
    return fromTotalMinutes(hours * 60);
  }

  function clientPointToDate(clientX, columnBounds) {
    if (!Array.isArray(columnBounds)) {
      return null;
    }

    const column = columnBounds.find((item, index) => {
      const isLast = index === columnBounds.length - 1;
      return clientX >= item.left && (clientX < item.right || (isLast && clientX <= item.right));
    });

    return column ? { ...column.date } : null;
  }

  function getFormatter(timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function getParts(timeZone, timestamp) {
    const parts = getFormatter(timeZone).formatToParts(new Date(timestamp));
    const values = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        values[part.type] = Number(part.value);
      }
    }

    if (values.hour === 24) {
      values.hour = 0;
    }

    return values;
  }

  function getOffsetMinutes(timeZone, timestamp) {
    const parts = getParts(timeZone, timestamp);
    const asUTC = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second || 0
    );
    return (asUTC - timestamp) / 60000;
  }

  function sameWallTime(timeZone, timestamp, wall) {
    const parts = getParts(timeZone, timestamp);
    return (
      parts.year === wall.year &&
      parts.month === wall.month &&
      parts.day === wall.day &&
      parts.hour === wall.hour &&
      parts.minute === wall.minute
    );
  }

  function zonedWallTimeToUtc(wall, timeZone) {
    const naiveUTC = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
    let offset = getOffsetMinutes(timeZone, naiveUTC);
    let candidate = naiveUTC - offset * 60000;
    const correctedOffset = getOffsetMinutes(timeZone, candidate);

    if (correctedOffset !== offset) {
      candidate = naiveUTC - correctedOffset * 60000;
    }

    const oneHourLater = candidate + 60 * 60000;
    if (sameWallTime(timeZone, candidate, wall) && sameWallTime(timeZone, oneHourLater, wall)) {
      return new Date(oneHourLater);
    }

    return new Date(candidate);
  }

  function addDays(date, days) {
    return new Date(Date.UTC(date.year, date.month - 1, date.day + days, 0, 0, 0, 0));
  }

  function buildSlot({ date, time, durationMinutes, timeZone }) {
    const startTotal = toTotalMinutes(time);
    const endTotal = startTotal + durationMinutes;
    const clamped = endTotal >= 1440;
    const finalEndTotal = clamped ? 1440 : endTotal;
    const endDate = finalEndTotal === 1440 ? addDays(date, 1) : null;

    const start = zonedWallTimeToUtc(
      {
        year: date.year,
        month: date.month,
        day: date.day,
        hour: Math.floor(startTotal / 60),
        minute: startTotal % 60
      },
      timeZone
    );

    const endWall = finalEndTotal === 1440
      ? {
          year: endDate.getUTCFullYear(),
          month: endDate.getUTCMonth() + 1,
          day: endDate.getUTCDate(),
          hour: 0,
          minute: 0
        }
      : {
          year: date.year,
          month: date.month,
          day: date.day,
          hour: Math.floor(finalEndTotal / 60),
          minute: finalEndTotal % 60
        };

    const end = zonedWallTimeToUtc(endWall, timeZone);

    return {
      id: global.crypto && typeof global.crypto.randomUUID === "function"
        ? global.crypto.randomUUID()
        : `slot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      startUTC: start.toISOString(),
      endUTC: end.toISOString(),
      clamped
    };
  }

  function dateKeyInZone(iso, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(iso));
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function formatDateHeader(dateKey, timeZone) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const middayUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(middayUTC);
  }

  function formatTime(iso, timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(iso));
  }

  function groupByDay(selections, timeZone) {
    const groups = new Map();
    for (const slot of selections.slice().sort((a, b) => a.startUTC.localeCompare(b.startUTC))) {
      const key = dateKeyInZone(slot.startUTC, timeZone);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(slot);
    }
    return groups;
  }

  function getZoneLabel(timeZone) {
    if (ZONE_LABELS[timeZone]) {
      return ZONE_LABELS[timeZone];
    }
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset"
    }).formatToParts(new Date()).find((item) => item.type === "timeZoneName");
    return part ? part.value.replace("GMT", "GMT") : timeZone;
  }

  function formatOutput(selections, timeZone) {
    if (!selections || selections.length === 0) {
      return "";
    }

    const groups = groupByDay(selections, timeZone);
    const label = getZoneLabel(timeZone);
    const sections = [];

    for (const [dateKey, slots] of groups.entries()) {
      const lines = [formatDateHeader(dateKey, timeZone)];
      for (const slot of slots) {
        lines.push(`  ${formatTime(slot.startUTC, timeZone)} - ${formatTime(slot.endUTC, timeZone)} ${label}`);
      }
      sections.push(lines.join("\n"));
    }

    return sections.join("\n\n");
  }

  function rangesOverlap(a, b) {
    return a.startUTC < b.endUTC && b.startUTC < a.endUTC;
  }

  function applySlotSelection(selections, newSlot) {
    const existing = selections.find((slot) => newSlot.startUTC >= slot.startUTC && newSlot.startUTC < slot.endUTC);
    if (existing) {
      return {
        selections: selections.filter((slot) => slot.id !== existing.id),
        action: "removed",
        conflict: null
      };
    }

    const conflict = selections.find((slot) => rangesOverlap(slot, newSlot));
    if (conflict) {
      return {
        selections,
        action: "conflict",
        conflict
      };
    }

    return {
      selections: selections.concat(newSlot),
      action: "added",
      conflict: null
    };
  }

  const api = {
    applySlotSelection,
    buildSlot,
    clientPointToDate,
    clientPointToTime,
    formatOutput,
    groupByDay,
    snapToIncrement,
    toTotalMinutes,
    zonedWallTimeToUtc
  };

  global.TimeSlotPickerUtils = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
