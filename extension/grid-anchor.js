(function attachGridAnchor(global) {
  "use strict";

  function parseHour(text) {
    const normalized = String(text || "").trim().toUpperCase();
    const match = normalized.match(/^(\d{1,2})(?::\d{2})?\s*(AM|PM)$/);
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

  const MONTHS = {
    JANUARY: 1,
    FEBRUARY: 2,
    MARCH: 3,
    APRIL: 4,
    MAY: 5,
    JUNE: 6,
    JULY: 7,
    AUGUST: 8,
    SEPTEMBER: 9,
    OCTOBER: 10,
    NOVEMBER: 11,
    DECEMBER: 12
  };

  function parseMonthYear(text) {
    const match = String(text || "").trim().match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
    );
    if (!match) {
      return null;
    }

    const year = Number(match[2]);
    if (year < 2000 || year > 2100) {
      return null;
    }

    const month = MONTHS[match[1].toUpperCase()];
    if (!Number.isInteger(month)) {
      return null;
    }

    return {
      year,
      month
    };
  }

  function findVisibleMonthYear(root) {
    const candidates = Array.from(root.querySelectorAll("[aria-label], h1, span, div"));
    for (const element of candidates) {
      const parsed = parseMonthYear(element.getAttribute("aria-label") || element.textContent);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  function parseViewDateFromUrl(root) {
    const href = String(
      (root && root.location && root.location.href) ||
      (global.location && global.location.href) ||
      ""
    );
    const match = href.match(/\/r\/(day|week)\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[/?#]|$)/);
    if (!match) {
      return null;
    }

    return {
      view: match[1],
      date: {
        year: Number(match[2]),
        month: Number(match[3]),
        day: Number(match[4])
      }
    };
  }

  function addDays(date, days) {
    const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 0, 0, 0, 0));
    return {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate()
    };
  }

  function getWeekStartDay(root) {
    const language =
      (root && root.navigator && root.navigator.language) ||
      (root && root.defaultView && root.defaultView.navigator && root.defaultView.navigator.language) ||
      (global.navigator && global.navigator.language);
    if (!language || typeof Intl.Locale !== "function") {
      return 0;
    }

    try {
      const locale = new Intl.Locale(language);
      const firstDay = locale.weekInfo && locale.weekInfo.firstDay;
      return Number.isInteger(firstDay) ? firstDay % 7 : 0;
    } catch (_error) {
      return 0;
    }
  }

  function startOfWeek(date, weekStartDay) {
    const current = new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0, 0));
    const startDay = Number.isInteger(weekStartDay) ? weekStartDay : 0;
    const daysSinceWeekStart = (current.getUTCDay() - startDay + 7) % 7;
    return addDays(date, -daysSinceWeekStart);
  }

  function resolveDayNumberNear(dayNumber, focusDate) {
    if (!focusDate || !dayNumber) {
      return null;
    }

    let best = null;
    for (let offset = -15; offset <= 15; offset += 1) {
      const candidate = addDays(focusDate, offset);
      if (candidate.day !== dayNumber) {
        continue;
      }
      if (!best || Math.abs(offset) < Math.abs(best.offset)) {
        best = { offset, date: candidate };
      }
    }

    return best ? best.date : null;
  }

  function resolveDayNumber(dayNumber, focusDate, monthYear) {
    return resolveDayNumberNear(dayNumber, focusDate) ||
      (monthYear ? { year: monthYear.year, month: monthYear.month, day: dayNumber } : null);
  }

  function parseVisibleDayHeader(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    const match = normalized.match(
      /^\s*(?:SUN(?:DAY)?|MON(?:DAY)?|TUE(?:S(?:DAY)?)?|WED(?:NESDAY)?|THU(?:R(?:S(?:DAY)?)?)?|FRI(?:DAY)?|SAT(?:URDAY)?)\b\D{0,24}(\d{1,2})\b\s*$/i
    );
    if (!match) {
      return null;
    }

    const dayNumber = Number(match[1]);
    return dayNumber >= 1 && dayNumber <= 31 ? dayNumber : null;
  }

  function findGridElement(root) {
    const candidates = findGridCandidates(root);
    return candidates.length > 0 ? candidates[0].element : null;
  }

  function findGridCandidates(root) {
    const selectors = [
      "[data-tsp-time-grid]",
      "[role='grid'][aria-label*='Calendar']",
      "div[role='grid']",
      "[data-viewkey]",
      "div[aria-label*='calendar']"
    ];

    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
      for (const element of Array.from(root.querySelectorAll(selector))) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);

        const rect = element.getBoundingClientRect();
        const hourLabelCount = findHourLabels(element).length;
        const usableSize = rect.width >= 240 && rect.height >= 240;
        candidates.push({
          element,
          selector,
          rect,
          hourLabelCount,
          usableSize,
          score: (usableSize ? 100000000 : 0) + hourLabelCount * 1000000 + rect.width * rect.height
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  // Hour labels match a short pattern ("8 AM"); skipping elements with long
  // text content avoids parseHour on every event title and saves a measurable
  // chunk of CPU on a busy Google Calendar week view.
  const MAX_HOUR_LABEL_TEXT = 12;
  const MAX_HOUR_LABEL_CANDIDATES = 600;

  function findHourLabels(root) {
    const candidates = root.querySelectorAll("[data-tsp-hour-label], [aria-label], span, div");
    const labels = [];
    const cap = Math.min(candidates.length, MAX_HOUR_LABEL_CANDIDATES);
    for (let i = 0; i < cap; i++) {
      const element = candidates[i];
      const text = element.getAttribute("data-tsp-hour-label") !== null
        ? (element.textContent || element.getAttribute("aria-label") || "")
        : (element.textContent || element.getAttribute("aria-label") || "");
      if (!text || text.length > MAX_HOUR_LABEL_TEXT) continue;
      const hour = parseHour(text);
      if (hour === null) continue;
      labels.push({ element, hour });
    }

    // Drop hidden/detached labels (zero-size rects, off-screen y<0) but keep
    // legitimate per-hour duplicates — Google Calendar layers the visible label
    // inside a taller row container at slightly different rect.top values, and
    // buildCalibration's median rejection needs both to converge on the right
    // pixelsPerHour. The actual fix for cross-layer pairing lives there.
    const unique = [];
    const seen = new Set();
    for (const item of labels) {
      const y = getHourLineY(item);
      if (y < 0) continue;
      const rect = item.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const key = `${item.hour}:${Math.round(y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    return unique.sort((a, b) => getHourLineY(a) - getHourLineY(b));
  }

  function getHourLineY(item) {
    const element = item && item.element ? item.element : item;
    const rect = element.getBoundingClientRect();
    const inlineTransform = element.style && element.style.transform;
    let computedTransform = "";
    if (typeof global.getComputedStyle === "function") {
      try {
        computedTransform = global.getComputedStyle(element).transform || "";
      } catch (_error) {
        computedTransform = "";
      }
    }
    const transform = inlineTransform || computedTransform;
    return hasVerticalTransform(transform) ? rect.top + rect.height / 2 : rect.top;
  }

  function hasVerticalTransform(transform) {
    if (!transform || transform === "none") {
      return false;
    }
    if (/translateY|translate3d|translate\(/i.test(transform)) {
      return true;
    }
    const matrix = String(transform).match(/^matrix\(([^)]+)\)$/i);
    if (matrix) {
      const parts = matrix[1].split(",").map((part) => Number(part.trim()));
      return Number.isFinite(parts[5]) && Math.abs(parts[5]) > 0.01;
    }
    const matrix3d = String(transform).match(/^matrix3d\(([^)]+)\)$/i);
    if (matrix3d) {
      const parts = matrix3d[1].split(",").map((part) => Number(part.trim()));
      return Number.isFinite(parts[13]) && Math.abs(parts[13]) > 0.01;
    }
    return false;
  }

  function findCalibrationLabels(root, grid) {
    const gridLabels = findHourLabels(grid);
    if (gridLabels.length >= 2) {
      return { labels: gridLabels, source: "grid" };
    }

    const gridRect = grid.getBoundingClientRect();
    const pageLabels = findHourLabels(root).filter((item) => {
      const rect = item.element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.top >= gridRect.top - 80 &&
        rect.top <= gridRect.bottom + 80 &&
        rect.right <= gridRect.left + 160
      );
    });

    return { labels: pageLabels, source: "page" };
  }

  function buildSemanticColumns(root) {
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

  function buildColumnsFromVisibleHeaders(root, grid, focusDate, monthYear) {
    if (!focusDate && !monthYear) {
      return [];
    }

    const gridRect = grid.getBoundingClientRect();
    const headerBandBottom = gridRect.top + Math.min(Math.max(gridRect.height * 0.2, 80), 180);
    const seen = new Set();
    return Array.from(root.querySelectorAll("[aria-label], span, div"))
      .map((header) => {
        const label = [
          header.getAttribute("aria-label") || "",
          header.textContent || ""
        ].join(" ");
        const dayNumber = parseVisibleDayHeader(label);
        const rect = header.getBoundingClientRect();
        if (
          !dayNumber ||
          rect.width <= 0 ||
          rect.right <= gridRect.left ||
          rect.left >= gridRect.right ||
          rect.top > headerBandBottom
        ) {
          return null;
        }

        const key = `${Math.round(rect.left)}:${Math.round(rect.right)}:${dayNumber}`;
        if (seen.has(key)) {
          return null;
        }
        seen.add(key);

        const date = resolveDayNumber(dayNumber, focusDate, monthYear);
        return date ? { left: rect.left, right: rect.right, date } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.left - b.left);
  }

  function parseStandaloneDayNumber(text) {
    const match = String(text || "").trim().match(/^(\d{1,2})$/);
    if (!match) {
      return null;
    }

    const dayNumber = Number(match[1]);
    return dayNumber >= 1 && dayNumber <= 31 ? dayNumber : null;
  }

  function buildColumnsFromSplitHeaders(root, grid, focusDate, monthYear) {
    if (!focusDate && !monthYear) {
      return [];
    }

    const gridRect = grid.getBoundingClientRect();
    const headerBandBottom = gridRect.top + Math.min(Math.max(gridRect.height * 0.2, 80), 180);
    const candidates = Array.from(root.querySelectorAll("[aria-label], span, div"))
      .map((element) => {
        const dayNumber = parseStandaloneDayNumber(element.textContent || element.getAttribute("aria-label"));
        const rect = element.getBoundingClientRect();
        if (
          !dayNumber ||
          rect.width <= 0 ||
          rect.right <= gridRect.left ||
          rect.left >= gridRect.right ||
          rect.top > headerBandBottom
        ) {
          return null;
        }

        const date = resolveDayNumber(dayNumber, focusDate, monthYear);
        return date
          ? { center: rect.left + rect.width / 2, date }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.center - b.center);

    if (candidates.length < 2) {
      return [];
    }

    const unique = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const key = `${candidate.date.year}-${candidate.date.month}-${candidate.date.day}:${Math.round(candidate.center)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(candidate);
      }
    }

    return unique.map((candidate, index) => {
      const prev = unique[index - 1];
      const next = unique[index + 1];
      const left = prev
        ? (prev.center + candidate.center) / 2
        : Math.max(gridRect.left, candidate.center - (next.center - candidate.center) / 2);
      const right = next
        ? (candidate.center + next.center) / 2
        : Math.min(gridRect.right, candidate.center + (candidate.center - prev.center) / 2);
      return {
        left,
        right,
        date: candidate.date
      };
    });
  }

  function buildColumnsFromUrl(root, grid) {
    const viewDate = parseViewDateFromUrl(root);
    if (!viewDate) {
      return [];
    }

    const rect = grid.getBoundingClientRect();
    if (rect.width <= 0) {
      return [];
    }

    if (viewDate.view === "day") {
      return [{ left: rect.left, right: rect.right, date: viewDate.date }];
    }

    const weekStart = startOfWeek(viewDate.date, getWeekStartDay(root));
    const columnWidth = rect.width / 7;
    const columns = [];
    for (let index = 0; index < 7; index += 1) {
      columns.push({
        left: rect.left + columnWidth * index,
        right: index === 6 ? rect.right : rect.left + columnWidth * (index + 1),
        date: addDays(weekStart, index)
      });
    }
    return columns;
  }

  function buildColumnResult(root, grid) {
    const semanticColumns = buildSemanticColumns(root);
    if (semanticColumns.length > 0) {
      return { columns: semanticColumns, source: "semantic" };
    }

    const viewDate = parseViewDateFromUrl(root);
    const monthYear = findVisibleMonthYear(root);
    const visibleHeaderColumns = buildColumnsFromVisibleHeaders(root, grid, viewDate && viewDate.date, monthYear);
    if (visibleHeaderColumns.length > 0) {
      return { columns: visibleHeaderColumns, source: "visible-header" };
    }

    const splitHeaderColumns = buildColumnsFromSplitHeaders(root, grid, viewDate && viewDate.date, monthYear);
    if (splitHeaderColumns.length > 0) {
      return { columns: splitHeaderColumns, source: "split-header" };
    }

    return { columns: buildColumnsFromUrl(root, grid), source: "url-estimate" };
  }

  function buildBounds(grid, labels, calibration, columns) {
    if (!grid || !calibration || !Array.isArray(columns) || columns.length === 0) {
      return null;
    }

    const gridRect = grid.getBoundingClientRect();
    const left = Math.max(gridRect.left, Math.min(...columns.map((column) => column.left)));
    const right = Math.min(gridRect.right, Math.max(...columns.map((column) => column.right)));
    const firstLabelTop = labels.length > 0
      ? getHourLineY(labels[0])
      : gridRect.top;
    const top = Math.max(gridRect.top, firstLabelTop - calibration.pixelsPerHour);
    const bottom = gridRect.bottom;

    if (right <= left || bottom <= top) {
      return null;
    }

    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  }

  function buildCalibration(grid, labels, scrollElement) {
    const MIN_PIXELS_PER_HOUR = 30;
    const MAX_PIXELS_PER_HOUR = 180;
    const candidates = [];

    // Pair every (earlier-hour, later-hour) combination rather than only
    // adjacent items in the sorted list. Google Calendar emits multiple labels
    // per hour (a visible 16px text node and a ~40px row container) at slightly
    // different rect.top values; adjacent-only pairing always crosses the layer
    // groups and produces a consistently-wrong delta (e.g. B 3AM y=26 →
    // A 4AM y=60 = 34 px/hr instead of the true 40). All-pairs feeds the
    // median below a richer population, so the correct value dominates.
    for (let i = 0; i < labels.length; i += 1) {
      const first = labels[i];
      const firstTop = getHourLineY(first);
      for (let j = i + 1; j < labels.length; j += 1) {
        const second = labels[j];
        const hourDelta = second.hour - first.hour;
        if (hourDelta <= 0) continue;

        const secondTop = getHourLineY(second);
        const pixelsPerHour = (secondTop - firstTop) / hourDelta;
        if (!Number.isFinite(pixelsPerHour) || pixelsPerHour <= 0) continue;
        if (pixelsPerHour < MIN_PIXELS_PER_HOUR || pixelsPerHour > MAX_PIXELS_PER_HOUR) continue;

        candidates.push({ first, firstTop, pixelsPerHour });
      }
    }

    if (candidates.length > 0) {
      const sortedPixels = candidates
        .map((candidate) => candidate.pixelsPerHour)
        .sort((a, b) => a - b);
      const medianPixels = sortedPixels[Math.floor(sortedPixels.length / 2)];
      const best = candidates
        .slice()
        .sort((a, b) => Math.abs(a.pixelsPerHour - medianPixels) - Math.abs(b.pixelsPerHour - medianPixels))[0];
      const gridRect = grid.getBoundingClientRect();
      return {
        gridRectTop: gridRect.top,
        scrollTop: 0,
        pixelsPerHour: best.pixelsPerHour,
        gridStartHour: best.first.hour - (best.firstTop - gridRect.top) / best.pixelsPerHour
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

    const labelResult = findCalibrationLabels(root, grid);
    const labels = labelResult.labels;
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

    const columnResult = buildColumnResult(root, grid);
    const columns = columnResult.columns;
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
      columns,
      bounds: buildBounds(grid, labels, calibration, columns),
      columnSource: columnResult.source,
      hourLabelSource: labelResult.source
    };
  }

  function summarizeRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }

  function trimText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function summarizeAnchorResult(result) {
    if (!result || !result.ok) {
      return result;
    }

    return {
      ok: true,
      columnSource: result.columnSource,
      hourLabelSource: result.hourLabelSource,
      calibration: result.calibration,
      bounds: result.bounds,
      columnCount: result.columns.length,
      columns: result.columns.map((column) => ({
        left: column.left,
        right: column.right,
        date: column.date
      }))
    };
  }

  function debugSnapshot(rootDocument) {
    const root = rootDocument || document;
    const grid = findGridElement(root);
    const labelResult = grid ? findCalibrationLabels(root, grid) : { labels: [], source: null };
    const hourLabels = labelResult.labels;
    const headerCandidates = Array.from(root.querySelectorAll("[aria-label], h1, span, div"))
      .map((element) => ({
        role: element.getAttribute("role") || "",
        ariaLabel: trimText(element.getAttribute("aria-label")),
        text: trimText(element.textContent),
        rect: summarizeRect(element),
        visibleDay: parseVisibleDayHeader([
          element.getAttribute("aria-label") || "",
          element.textContent || ""
        ].join(" ")),
        standaloneDay: parseStandaloneDayNumber(element.textContent || element.getAttribute("aria-label"))
      }))
      .filter((candidate) => candidate.text || candidate.ariaLabel)
      .slice(0, 80);

    return {
      href: String(
        (root && root.location && root.location.href) ||
        (global.location && global.location.href) ||
        ""
      ),
      monthYear: findVisibleMonthYear(root),
      viewDate: parseViewDateFromUrl(root),
      gridRect: grid ? summarizeRect(grid) : null,
      hourLabelSource: labelResult.source,
      anchor: summarizeAnchorResult(findGridAnchor(root)),
      gridCandidates: findGridCandidates(root).map((candidate) => ({
        selector: candidate.selector,
        hourLabelCount: candidate.hourLabelCount,
        usableSize: candidate.usableSize,
        rect: {
          left: candidate.rect.left,
          top: candidate.rect.top,
          right: candidate.rect.right,
          bottom: candidate.rect.bottom,
          width: candidate.rect.width,
          height: candidate.rect.height
        }
      })).slice(0, 20),
      hourCandidates: hourLabels.map((item) => ({
        hour: item.hour,
        text: trimText(item.element.textContent || item.element.getAttribute("aria-label")),
        rect: summarizeRect(item.element)
      })),
      headerCandidates
    };
  }

  const api = {
    debugSnapshot,
    findGridAnchor,
    parseHour
  };

  global.TimeSlotPickerGridAnchor = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
