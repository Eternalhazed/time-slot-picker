(function attachGridAnchor(global) {
  "use strict";

  function parseHour(text) {
    const normalized = String(text || "").trim().toUpperCase();
    const match = normalized.match(/\b(\d{1,2})(?::\d{2})?\s*(AM|PM)\b/);
    if (!match) {
      return null;
    }

    let hour = Number(match[1]);
    const meridiem = match[2];
    if (hour === 12) {
      hour = meridiem === "AM" ? 0 : 12;
    } else if (meridiem === "PM") {
      hour += 12;
    }
    return hour;
  }

  function parseDateFromHeader(header) {
    const explicit = header.getAttribute("data-date") || header.getAttribute("data-tsp-date");
    if (explicit) {
      const match = explicit.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        return {
          year: Number(match[1]),
          month: Number(match[2]),
          day: Number(match[3])
        };
      }
    }

    const label = header.getAttribute("aria-label") || header.textContent || "";
    const parsed = Date.parse(label);
    if (!Number.isNaN(parsed)) {
      const date = new Date(parsed);
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate()
      };
    }

    return null;
  }

  function findGridElement(root) {
    const selectors = [
      "[data-tsp-time-grid]",
      "[role='grid'][aria-label*='Calendar']",
      "[role='grid']",
      "[data-viewkey]",
      "div[aria-label*='calendar']"
    ];

    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element) {
        return element;
      }
    }

    return null;
  }

  function findHourLabels(root) {
    const labels = Array.from(root.querySelectorAll("[data-tsp-hour-label], [aria-label], span, div"))
      .map((element) => ({ element, hour: parseHour(element.textContent) }))
      .filter((item) => item.hour !== null);

    const unique = [];
    const seen = new Set();
    for (const item of labels) {
      const rect = item.element.getBoundingClientRect();
      const key = `${item.hour}:${Math.round(rect.top)}`;
      if (!seen.has(key) && rect.top >= 0) {
        seen.add(key);
        unique.push(item);
      }
    }

    return unique.sort((a, b) => a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top);
  }

  function buildColumns(root) {
    return Array.from(root.querySelectorAll("[role='columnheader']"))
      .map((header) => {
        const date = parseDateFromHeader(header);
        const rect = header.getBoundingClientRect();
        if (!date || rect.width <= 0) {
          return null;
        }
        return {
          left: rect.left,
          right: rect.right,
          date
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.left - b.left);
  }

  function buildCalibration(grid, labels, scrollElement) {
    for (let index = 0; index < labels.length - 1; index += 1) {
      const first = labels[index];
      const second = labels[index + 1];
      const hourDelta = second.hour - first.hour;
      if (hourDelta <= 0) {
        continue;
      }

      const firstTop = first.element.getBoundingClientRect().top;
      const secondTop = second.element.getBoundingClientRect().top;
      const pixelsPerHour = (secondTop - firstTop) / hourDelta;
      if (!Number.isFinite(pixelsPerHour) || pixelsPerHour <= 0) {
        continue;
      }

      const gridRect = grid.getBoundingClientRect();
      return {
        gridRectTop: gridRect.top,
        scrollTop: scrollElement ? scrollElement.scrollTop || 0 : 0,
        pixelsPerHour,
        gridStartHour: first.hour - (firstTop - gridRect.top) / pixelsPerHour
      };
    }

    return null;
  }

  function findGridAnchor(rootDocument) {
    const root = rootDocument || document;
    const grid = findGridElement(root);
    if (!grid) {
      return {
        ok: false,
        reason: "Time grid not detected."
      };
    }

    const labels = findHourLabels(grid);
    if (labels.length < 2) {
      return {
        ok: false,
        reason: "Hour labels could not be parsed."
      };
    }

    const scrollElement = grid.querySelector("[data-tsp-scroll]") || grid.querySelector("[style*='overflow']") || grid;
    const calibration = buildCalibration(grid, labels, scrollElement);
    if (!calibration) {
      return {
        ok: false,
        reason: "Time grid calibration failed."
      };
    }

    const columns = buildColumns(root);
    if (columns.length === 0) {
      return {
        ok: false,
        reason: "Date columns not detected."
      };
    }

    return {
      ok: true,
      grid,
      scrollElement,
      calibration,
      columns
    };
  }

  const api = {
    findGridAnchor,
    parseHour
  };

  global.TimeSlotPickerGridAnchor = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
