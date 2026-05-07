(function attachCaptureOverlay(global) {
  "use strict";

  function createCaptureOverlay({ anchor, durationMinutes, calendarTimezone, selections, onSlot, onError }) {
    const utils = global.TimeSlotPickerUtils;
    const overlay = document.createElement("div");
    overlay.className = "tsp-capture-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const preview = document.createElement("div");
    preview.className = "tsp-preview";
    overlay.appendChild(preview);

    const markersContainer = document.createElement("div");
    markersContainer.className = "tsp-markers";
    overlay.appendChild(markersContainer);

    let currentSelections = selections || [];

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
      return col ? { left: col.left, width: col.right - col.left } : null;
    }

    function renderMarkers() {
      markersContainer.innerHTML = "";
      if (!anchor || !anchor.calibration || !anchor.columns) return;

      const gridRect = anchor.grid.getBoundingClientRect();

      for (const slot of currentSelections) {
        const startDate = new Date(slot.startUTC);
        const endDate = new Date(slot.endUTC);

        const startFmt = new Intl.DateTimeFormat("en-US", {
          timeZone: calendarTimezone,
          hour12: false,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit"
        }).formatToParts(startDate);
        const endFmt = new Intl.DateTimeFormat("en-US", {
          timeZone: calendarTimezone,
          hour12: false,
          hour: "2-digit", minute: "2-digit"
        }).formatToParts(endDate);

        const sv = {};
        for (const p of startFmt) { if (p.type !== "literal") sv[p.type] = Number(p.value); }
        const ev = {};
        for (const p of endFmt) { if (p.type !== "literal") ev[p.type] = Number(p.value); }
        if (sv.hour === 24) sv.hour = 0;
        if (ev.hour === 24) ev.hour = 0;

        const col = dateToX({ year: sv.year, month: sv.month, day: sv.day });
        if (!col) continue;

        const top = timeToY(sv.hour, sv.minute);
        const bottom = timeToY(ev.hour, ev.minute);
        if (top === null || bottom === null) continue;

        const marker = document.createElement("div");
        marker.className = "tsp-marker";
        marker.style.left = (col.left - gridRect.left) + "px";
        marker.style.width = col.width + "px";
        marker.style.top = (top - gridRect.top) + "px";
        marker.style.height = Math.max(4, bottom - top) + "px";
        markersContainer.appendChild(marker);
      }
    }

    function updatePosition(nextAnchor) {
      anchor = nextAnchor || anchor;
      if (!anchor || !anchor.grid) {
        return;
      }
      const rect = anchor.grid.getBoundingClientRect();
      overlay.style.left = Math.max(0, rect.left) + "px";
      overlay.style.top = Math.max(0, rect.top) + "px";
      overlay.style.width = Math.max(0, rect.width) + "px";
      overlay.style.height = Math.max(0, rect.height) + "px";
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
      const wallTime = utils.clientPointToTime(event.clientY, anchor.calibration);
      const date = utils.clientPointToDate(event.clientX, anchor.columns);

      if (!wallTime || !date) {
        preview.style.display = "none";
        return;
      }

      const snapped = utils.snapToIncrement(wallTime, 15);
      const startHour = Math.floor(utils.toTotalMinutes(snapped) / 60);
      const startMin = utils.toTotalMinutes(snapped) % 60;
      const endTotal = utils.toTotalMinutes(snapped) + durationMinutes;
      const endHour = Math.floor(Math.min(endTotal, 1439) / 60);
      const endMin = Math.min(endTotal, 1439) % 60;

      const gridRect = anchor.grid.getBoundingClientRect();
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
      preview.style.left = (col.left - gridRect.left) + "px";
      preview.style.width = col.width + "px";
      preview.style.top = (top - gridRect.top) + "px";
      preview.style.height = Math.max(4, bottom - top) + "px";
    }

    function handlePointerLeave() {
      preview.style.display = "none";
    }

    function handlePointerDown(event) {
      event.preventDefault();
      event.stopPropagation();

      const wallTime = utils.clientPointToTime(event.clientY, anchor.calibration);
      const date = utils.clientPointToDate(event.clientX, anchor.columns);

      if (!wallTime || !date) {
        if (onError) onError("Click did not land inside a selectable day column.");
        flash("conflict");
        return;
      }

      const snapped = utils.snapToIncrement(wallTime, 15);
      const slot = utils.buildSlot({
        date,
        time: snapped,
        durationMinutes,
        timeZone: calendarTimezone
      });

      onSlot(slot);
    }

    overlay.addEventListener("pointerdown", handlePointerDown);
    overlay.addEventListener("pointermove", handlePointerMove);
    overlay.addEventListener("pointerleave", handlePointerLeave);
    document.body.appendChild(overlay);
    updatePosition(anchor);

    return {
      element: overlay,
      flash,
      updatePosition,
      updateSelections,
      destroy: function () {
        overlay.removeEventListener("pointerdown", handlePointerDown);
        overlay.removeEventListener("pointermove", handlePointerMove);
        overlay.removeEventListener("pointerleave", handlePointerLeave);
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
