(function attachTimeUtils(global) {
  "use strict";

  const ZONE_LABELS = {
    "America/New_York": "ET",
    "America/Chicago": "CT",
    "America/Denver": "MT",
    "America/Phoenix": "MST",
    "America/Los_Angeles": "PT",
    "America/Anchorage": "AKT",
    "Pacific/Honolulu": "HT",
    UTC: "UTC",
    GMT: "GMT",
    "Europe/London": "GMT",
    "Europe/Paris": "CET",
    "Asia/Tokyo": "JST"
  };

  // US zones surfaced first in the UI. Phoenix/Honolulu kept separate
  // because they do not observe DST and routinely surprise users.
  const US_PRIORITY_ZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu"
  ];

  const INTERNATIONAL_COMMON_ZONES = [
    "UTC",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Asia/Kolkata",
    "Australia/Sydney"
  ];

  const DEFAULT_FORMAT_OPTIONS = {
    clock: "12h",
    includeDate: true,
    includeZoneLabel: true,
    excludePast: true,
    separator: " - ",
    prefixMessage: ""
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
    const snapped = Math.min(
      Math.round(total / incrementMinutes) * incrementMinutes,
      1440 - incrementMinutes
    );
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
    if (!Number.isFinite(hours)) return null;
    // fromTotalMinutes already clamps to [0, 1439]; this guards against NaN
    // and against absurd inputs (e.g., clicks far below the calendar grid).
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
    const offsets = Array.from(new Set([
      getOffsetMinutes(timeZone, naiveUTC - 12 * 60 * 60000),
      getOffsetMinutes(timeZone, naiveUTC),
      getOffsetMinutes(timeZone, naiveUTC + 12 * 60 * 60000)
    ]));
    const candidates = offsets
      .map((offset) => naiveUTC - offset * 60000)
      .sort((a, b) => a - b);
    const matchingCandidates = candidates.filter((candidate) => sameWallTime(timeZone, candidate, wall));

    if (matchingCandidates.length > 0) {
      return new Date(matchingCandidates[matchingCandidates.length - 1]);
    }

    return new Date(candidates[candidates.length - 1]);
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

  function wallTimeToUtcIso(date, time, timeZone) {
    const total = toTotalMinutes(time);
    return zonedWallTimeToUtc(
      {
        year: date.year,
        month: date.month,
        day: date.day,
        hour: Math.floor(total / 60),
        minute: total % 60
      },
      timeZone
    ).toISOString();
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

  function formatTime(iso, timeZone, options) {
    const opts = options || DEFAULT_FORMAT_OPTIONS;
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: opts.clock === "24h" ? "2-digit" : "numeric",
      minute: "2-digit",
      hour12: opts.clock !== "24h"
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

  function normalizeFormatOptions(options) {
    const base = Object.assign({}, DEFAULT_FORMAT_OPTIONS, options || {});
    if (base.clock !== "12h" && base.clock !== "24h") {
      base.clock = DEFAULT_FORMAT_OPTIONS.clock;
    }
    base.includeDate = base.includeDate !== false;
    base.includeZoneLabel = base.includeZoneLabel !== false;
    base.excludePast = base.excludePast !== false;
    base.separator = typeof base.separator === "string" && base.separator.length > 0
      ? base.separator
      : DEFAULT_FORMAT_OPTIONS.separator;
    base.prefixMessage = typeof base.prefixMessage === "string" ? base.prefixMessage : "";
    return base;
  }

  function formatOutput(selections, timeZone, options, nowMs) {
    if (!selections || selections.length === 0) {
      return "";
    }

    const opts = normalizeFormatOptions(options);
    let filtered = selections;
    if (opts.excludePast) {
      const cutoff = typeof nowMs === "number" ? nowMs : Date.now();
      filtered = selections.filter((slot) => {
        const end = Date.parse(slot.endUTC);
        return !Number.isFinite(end) || end > cutoff;
      });
    }
    if (filtered.length === 0) return "";

    const groups = groupByDay(filtered, timeZone);
    const label = opts.includeZoneLabel ? getZoneLabel(timeZone) : "";
    const sections = [];

    for (const [dateKey, slots] of groups.entries()) {
      const lines = [];
      if (opts.includeDate) {
        lines.push(formatDateHeader(dateKey, timeZone));
      }
      for (const slot of slots) {
        const range = `${formatTime(slot.startUTC, timeZone, opts)}${opts.separator}${formatTime(slot.endUTC, timeZone, opts)}`;
        const suffix = label ? ` ${label}` : "";
        const prefix = opts.includeDate ? "  " : "";
        lines.push(`${prefix}${range}${suffix}`);
      }
      sections.push(lines.join("\n"));
    }

    const body = sections.join(opts.includeDate ? "\n\n" : "\n");
    const prefix = opts.prefixMessage && opts.prefixMessage.trim();
    return prefix ? prefix + "\n\n" + body : body;
  }

  function pruneStaleSelections(selections, now) {
    if (!Array.isArray(selections) || selections.length === 0) {
      return { kept: [], removed: [] };
    }
    const cutoffMs = typeof now === "number"
      ? now
      : (now instanceof Date ? now.getTime() : Date.parse(now));
    if (!Number.isFinite(cutoffMs)) {
      return { kept: selections.slice(), removed: [] };
    }
    const kept = [];
    const removed = [];
    for (const slot of selections) {
      const end = Date.parse(slot.endUTC);
      if (Number.isFinite(end) && end <= cutoffMs) {
        removed.push(slot);
      } else {
        kept.push(slot);
      }
    }
    return { kept, removed };
  }

  function isValidTimezone(timeZone) {
    if (typeof timeZone !== "string" || timeZone.length === 0) {
      return false;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
      return true;
    } catch (_error) {
      return false;
    }
  }

  function detectTimezone() {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return zone && isValidTimezone(zone) ? zone : "UTC";
    } catch (_error) {
      return "UTC";
    }
  }

  function buildZoneOptionGroups(detectedZone) {
    const supported = typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
    const supportedSet = new Set(supported);
    const detected = detectedZone && isValidTimezone(detectedZone) ? detectedZone : null;

    function filterValid(zones) {
      return zones.filter((zone) => isValidTimezone(zone) && (supportedSet.size === 0 || supportedSet.has(zone)));
    }

    const usZones = filterValid(US_PRIORITY_ZONES);
    const intlZones = filterValid(INTERNATIONAL_COMMON_ZONES);
    const featured = new Set([...usZones, ...intlZones]);
    if (detected) featured.add(detected);
    const others = supported.filter((zone) => !featured.has(zone));

    const groups = [];
    if (detected) {
      groups.push({ label: "Detected", zones: [detected] });
    }
    groups.push({ label: "United States", zones: usZones.filter((zone) => zone !== detected) });
    if (intlZones.length > 0) {
      groups.push({ label: "International", zones: intlZones.filter((zone) => zone !== detected) });
    }
    if (others.length > 0) {
      groups.push({ label: "All timezones", zones: others });
    }
    return groups.filter((group) => group.zones.length > 0);
  }

  function rangesOverlap(a, b) {
    return a.startUTC < b.endUTC && b.startUTC < a.endUTC;
  }

  function applySlotSelection(selections, newSlot) {
    const selectionPointUTC = newSlot.selectionPointUTC || newSlot.startUTC;
    const existing = selections.find((slot) => selectionPointUTC >= slot.startUTC && selectionPointUTC < slot.endUTC);
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

    const storedSlot = {
      id: newSlot.id,
      startUTC: newSlot.startUTC,
      endUTC: newSlot.endUTC,
      clamped: Boolean(newSlot.clamped)
    };
    return {
      selections: selections.concat(storedSlot),
      action: "added",
      conflict: null
    };
  }

  const api = {
    applySlotSelection,
    buildSlot,
    buildZoneOptionGroups,
    clientPointToDate,
    clientPointToTime,
    detectTimezone,
    formatOutput,
    getZoneLabel,
    groupByDay,
    isValidTimezone,
    normalizeFormatOptions,
    pruneStaleSelections,
    snapToIncrement,
    toTotalMinutes,
    wallTimeToUtcIso,
    zonedWallTimeToUtc,
    DEFAULT_FORMAT_OPTIONS,
    US_PRIORITY_ZONES,
    INTERNATIONAL_COMMON_ZONES
  };

  global.TimeSlotPickerUtils = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
