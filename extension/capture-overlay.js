(function attachCaptureOverlay(global) {
  "use strict";

  function createCaptureOverlay({ anchor, durationMinutes, calendarTimezone, selections, captureEnabled, onSlot, onError }) {
    const utils = global.TimeSlotPickerUtils;
    const SNAP_INCREMENT_MINUTES = 15;
    const overlay = document.createElement("div");
    overlay.className = "tsp-capture-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const columnLayer = document.createElement("div");
    columnLayer.className = "tsp-capture-columns";
    overlay.appendChild(columnLayer);

    const preview = document.createElement("div");
    preview.className = "tsp-preview";
    overlay.appendChild(preview);

    const markersContainer = document.createElement("div");
    markersContainer.className = "tsp-markers";
    overlay.appendChild(markersContainer);

    let currentSelections = selections || [];
    let currentDurationMinutes = durationMinutes;
    let currentCalendarTimezone = calendarTimezone;
    let currentCaptureEnabled = captureEnabled !== false;

    function getOverlayRect() {
      return anchor && anchor.bounds ? anchor.bounds : anchor.grid.getBoundingClientRect();
    }

    function clipColumnToRect(column, overlayRect) {
      const left = Math.max(column.left, overlayRect.left);
      const right = Math.min(column.right, overlayRect.right);
      if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
        return null;
      }

      return {
        date: column.date,
        left,
        right,
        width: right - left
      };
    }

    function clipColumnToOverlay(column) {
      return clipColumnToRect(column, getOverlayRect());
    }

    function buildColumnIndex(overlayRect) {
      const index = Object.create(null);
      if (!anchor || !Array.isArray(anchor.columns)) return index;
      for (const column of anchor.columns) {
        const clipped = clipColumnToRect(column, overlayRect);
        if (!clipped) continue;
        index[column.date.year + "-" + column.date.month + "-" + column.date.day] = clipped;
      }
      return index;
    }

    function getSelectableColumns(overlayRect) {
      if (!anchor || !Array.isArray(anchor.columns)) return [];
      const rect = overlayRect || getOverlayRect();
      const out = [];
      for (const column of anchor.columns) {
        const clipped = clipColumnToRect(column, rect);
        if (clipped) out.push(clipped);
      }
      return out;
    }

    function timeToY(hour, minute) {
      if (!anchor || !anchor.calibration) return null;
      const totalHours = hour + minute / 60;
      const cal = anchor.calibration;
      return cal.gridRectTop + (totalHours - cal.gridStartHour) * cal.pixelsPerHour - (cal.scrollTop || 0);
    }

    function dateToX(date) {
      if (!anchor || !anchor.columns) return null;
      const col = anchor.columns.find(function (c) {
        return c.date.year === date.year && c.date.month === date.month && c.date.day === date.day;
      });
      return col ? clipColumnToOverlay(col) : null;
    }

    function timeFromTotalMinutes(totalMinutes) {
      const clamped = Math.max(0, Math.min(1440, Math.round(totalMinutes)));
      return {
        hour: Math.floor(clamped / 60),
        minute: clamped % 60,
        totalMinutes: clamped
      };
    }

    function snapSlotStartAroundPointer(wallTime) {
      const centerTotal = utils.toTotalMinutes(wallTime);
      const maxStart = Math.max(0, 1440 - currentDurationMinutes);
      const rawStart = centerTotal - currentDurationMinutes / 2;
      const snappedStart = Math.round(rawStart / SNAP_INCREMENT_MINUTES) * SNAP_INCREMENT_MINUTES;
      return timeFromTotalMinutes(Math.max(0, Math.min(maxStart, snappedStart)));
    }

    function renderCaptureColumns() {
      columnLayer.innerHTML = "";
      if (!currentCaptureEnabled) {
        preview.style.display = "none";
        return;
      }

      const overlayRect = getOverlayRect();
      const columns = getSelectableColumns(overlayRect);

      for (const column of columns) {
        const strip = document.createElement("div");
        strip.className = "tsp-capture-column";
        strip.style.left = (column.left - overlayRect.left) + "px";
        strip.style.width = column.width + "px";
        strip.addEventListener("pointerdown", handlePointerDown);
        strip.addEventListener("pointermove", handlePointerMove);
        strip.addEventListener("pointerleave", handlePointerLeave);
        columnLayer.appendChild(strip);
      }
    }

    function renderMarkers() {
      markersContainer.innerHTML = "";
      if (!anchor || !anchor.calibration || !anchor.columns) return;

      const overlayRect = getOverlayRect();
      const columnIndex = buildColumnIndex(overlayRect);
      if (Object.keys(columnIndex).length === 0) return;

      const startFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: currentCalendarTimezone,
        hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
      const endFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: currentCalendarTimezone,
        hour12: false,
        hour: "2-digit", minute: "2-digit"
      });

      const fragment = document.createDocumentFragment();
      for (const slot of currentSelections) {
        const startParts = startFormatter.formatToParts(new Date(slot.startUTC));
        const endParts = endFormatter.formatToParts(new Date(slot.endUTC));

        const sv = {};
        for (const p of startParts) { if (p.type !== "literal") sv[p.type] = Number(p.value); }
        const ev = {};
        for (const p of endParts) { if (p.type !== "literal") ev[p.type] = Number(p.value); }
        if (sv.hour === 24) sv.hour = 0;
        if (ev.hour === 24) ev.hour = 0;

        const col = columnIndex[sv.year + "-" + sv.month + "-" + sv.day];
        if (!col) continue;

        const top = timeToY(sv.hour, sv.minute);
        const bottom = timeToY(ev.hour, ev.minute);
        if (top === null || bottom === null) continue;

        const marker = document.createElement("div");
        marker.className = "tsp-marker";
        marker.style.left = (col.left - overlayRect.left) + "px";
        marker.style.width = col.width + "px";
        marker.style.top = (top - overlayRect.top) + "px";
        marker.style.height = Math.max(4, bottom - top) + "px";
        fragment.appendChild(marker);
      }
      markersContainer.appendChild(fragment);
    }

    function updateOptions(nextOptions) {
      const options = nextOptions || {};
      if (Object.prototype.hasOwnProperty.call(options, "durationMinutes")) {
        currentDurationMinutes = options.durationMinutes;
      }
      if (Object.prototype.hasOwnProperty.call(options, "calendarTimezone")) {
        currentCalendarTimezone = options.calendarTimezone;
      }
      if (Object.prototype.hasOwnProperty.call(options, "captureEnabled")) {
        currentCaptureEnabled = options.captureEnabled !== false;
      }
      if (Object.prototype.hasOwnProperty.call(options, "selections")) {
        currentSelections = options.selections || [];
      }

      renderCaptureColumns();
      renderMarkers();
    }

    function updatePosition(nextAnchor) {
      anchor = nextAnchor || anchor;
      if (!anchor || !anchor.grid) {
        return;
      }
      const rect = getOverlayRect();
      overlay.style.left = Math.max(0, rect.left) + "px";
      overlay.style.top = Math.max(0, rect.top) + "px";
      overlay.style.width = Math.max(0, rect.width) + "px";
      overlay.style.height = Math.max(0, rect.height) + "px";
      renderCaptureColumns();
      renderMarkers();
    }

    function updateSelections(nextSelections) {
      currentSelections = nextSelections || [];
      renderMarkers();
    }

    function flash(kind) {
      overlay.classList.remove("tsp-flash-conflict", "tsp-flash-ok");
      void overlay.offsetWidth;
      overlay.classList.add(kind === "conflict" ? "tsp-flash-conflict" : "tsp-flash-ok");
      global.setTimeout(function () {
        overlay.classList.remove("tsp-flash-conflict", "tsp-flash-ok");
      }, 450);
    }

    function handlePointerMove(event) {
      if (!currentCaptureEnabled) return;

      const wallTime = utils.clientPointToTime(event.clientY, anchor.calibration);
      const date = utils.clientPointToDate(event.clientX, anchor.columns);

      if (!wallTime || !date) {
        preview.style.display = "none";
        return;
      }

      const snappedStart = snapSlotStartAroundPointer(wallTime);
      const startTotal = utils.toTotalMinutes(snappedStart);
      const startHour = Math.floor(startTotal / 60);
      const startMin = startTotal % 60;
      const endTotal = Math.min(startTotal + currentDurationMinutes, 1440);
      const endHour = Math.floor(endTotal / 60);
      const endMin = endTotal % 60;

      const overlayRect = getOverlayRect();
      const col = dateToX(date);
      if (!col) {
        preview.style.display = "none";
        return;
      }

      const top = timeToY(startHour, startMin);
      const bottom = timeToY(endHour, endMin);
      if (top === null || bottom === null) {
        preview.style.display = "none";
        return;
      }

      preview.style.display = "block";
      preview.style.left = (col.left - overlayRect.left) + "px";
      preview.style.width = col.width + "px";
      preview.style.top = (top - overlayRect.top) + "px";
      preview.style.height = Math.max(4, bottom - top) + "px";
    }

    function handlePointerLeave() {
      preview.style.display = "none";
    }

    function handlePointerDown(event) {
      if (!currentCaptureEnabled) return;

      event.preventDefault();
      event.stopPropagation();

      const wallTime = utils.clientPointToTime(event.clientY, anchor.calibration);
      const date = utils.clientPointToDate(event.clientX, anchor.columns);

      if (!wallTime || !date) {
        if (onError) onError("Click did not land inside a selectable day column.");
        flash("conflict");
        return;
      }

      const snapped = snapSlotStartAroundPointer(wallTime);
      const slot = utils.buildSlot({
        date,
        time: snapped,
        durationMinutes: currentDurationMinutes,
        timeZone: currentCalendarTimezone
      });
      slot.selectionPointUTC = utils.wallTimeToUtcIso(date, wallTime, currentCalendarTimezone);

      onSlot(slot);
    }

    document.body.appendChild(overlay);
    updatePosition(anchor);

    return {
      element: overlay,
      flash,
      updateOptions,
      updatePosition,
      updateSelections,
      destroy: function () {
        overlay.remove();
      }
    };
  }

  const api = {
    createCaptureOverlay
  };

  global.TimeSlotPickerCaptureOverlay = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
