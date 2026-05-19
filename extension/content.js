(function bootTimeSlotPicker(global) {
  "use strict";

  if (global.__timeSlotPickerBooted) {
    return;
  }
  global.__timeSlotPickerBooted = true;

  var utils = global.TimeSlotPickerUtils;
  var storage = global.TimeSlotPickerStorage;
  var gridAnchor = global.TimeSlotPickerGridAnchor;
  var capture = global.TimeSlotPickerCaptureOverlay;

  var GRID_REFRESH_INTERVAL_MS = 2500;
  var URL_REFRESH_INTERVAL_MS = 1000;
  var ERROR_STATUS_PROTECT_MS = 400;

  var state = storage.createDefaultState();
  var scope = storage.getAccountScope(global.location.href);
  var anchor = null;
  var overlay = null;
  var root = null;
  var statusNode = null;
  var outputNode = null;
  var slotListNode = null;
  var modeButton = null;
  var clearButton = null;
  var clearPastButton = null;
  var detectTzButton = null;
  var copyButton = null;
  var tabButton = null;
  var calendarZoneSelect = null;
  var outputZoneSelect = null;
  var formatClockNodes = [];
  var formatIncludeDateNode = null;
  var formatIncludeZoneNode = null;
  var formatExcludePastNode = null;
  var formatPrefixMessageNode = null;
  var autoDetectCheckbox = null;
  var durationButtons = [];
  var detectTimer = null;
  var urlTimer = null;
  var saveTimer = null;
  var clearConfirmTimer = null;
  var anchorFailureStartedAt = null;
  var lastDebugWarnKey = null;
  var lastErrorAt = 0;
  var pendingWriteToken = null;
  var undoStack = [];
  var rendering = false;
  var slotListSignature = null;
  var slotListPastCount = 0;
  var observersRunning = false;
  var pastStateTimer = null;
  var detailsNodes = {};
  var summaryNodes = {};
  var chromeMessagesWired = false;
  var pendingShowSidebar = false;

  function getSelections() {
    return storage.getSelectionsForScope(state, scope);
  }

  function saveState() {
    global.clearTimeout(saveTimer);
    pendingWriteToken = serializeStateSnapshot(state);
    var token = pendingWriteToken;
    saveTimer = global.setTimeout(function () {
      storage.writeState(state, function (error) {
        if (error) {
          setStatus("Couldn't save — Chrome storage error.", "error");
        }
        // Only clear the token if no newer write has been queued in the meantime.
        if (pendingWriteToken === token) {
          pendingWriteToken = null;
        }
      });
    }, 120);
  }

  function serializeStateSnapshot(snapshot) {
    try {
      return JSON.stringify(snapshot);
    } catch (_error) {
      return null;
    }
  }

  function setStatus(message, kind) {
    if (!statusNode) return;
    var now = Date.now();
    if (kind !== "error" && lastErrorAt > 0 && now - lastErrorAt < ERROR_STATUS_PROTECT_MS) {
      return;
    }
    if (kind === "error") {
      lastErrorAt = now;
    }
    statusNode.textContent = message;
    statusNode.dataset.kind = kind || "neutral";
  }

  function pushUndo() {
    undoStack.push(getSelections().slice());
    if (undoStack.length > 30) undoStack.shift();
  }

  function undo() {
    if (undoStack.length === 0) {
      setStatus("Nothing to undo.", "neutral");
      return;
    }
    var prev = undoStack.pop();
    state = storage.setSelectionsForScope(state, scope, prev);
    invalidateSlotListCache();
    saveState();
    render();
    syncOverlaySelections();
    setStatus("Undone.", "ok");
  }

  function setSelections(selections) {
    state = storage.setSelectionsForScope(state, scope, selections);
    invalidateSlotListCache();
    saveState();
    render();
    syncOverlaySelections();
  }

  function removeSlotById(id) {
    var selections = getSelections();
    var filtered = selections.filter(function (s) { return s.id !== id; });
    if (filtered.length === selections.length) return;
    pushUndo();
    setSelections(filtered);
    setStatus("Slot removed.", "ok");
  }

  function clearPastSelections(announce) {
    var nowMs = Date.now();
    var result = storage.pruneStaleFromState(state, nowMs);
    if (result.removedCount === 0) {
      if (announce) setStatus("Nothing in the past to clear.", "neutral");
      return 0;
    }
    pushUndo();
    state = result.state;
    saveState();
    render();
    syncOverlaySelections();
    if (announce) {
      setStatus("Removed " + result.removedCount + " past slot" + (result.removedCount === 1 ? "" : "s") + ".", "ok");
    }
    return result.removedCount;
  }

  function shouldShowOverlay() {
    return state.selectModeOn || getSelections().length > 0;
  }

  function syncOverlaySelections() {
    syncOverlayState();
  }

  function syncOverlayOptions() {
    if (!overlay) return;
    var selections = getSelections();
    var options = {
      durationMinutes: state.lastDuration,
      calendarTimezone: state.calendarTimezone,
      captureEnabled: Boolean(state.selectModeOn),
      selections: selections
    };
    if (typeof overlay.updateOptions === "function") {
      overlay.updateOptions(options);
    } else if (typeof overlay.updateSelections === "function") {
      overlay.updateSelections(selections);
    }
  }

  function syncOverlayState() {
    if (!shouldShowOverlay()) {
      stopOverlay();
      return;
    }
    if (!anchor || !anchor.ok || !hasUsableBounds(anchor)) {
      return;
    }
    if (!overlay) {
      startOverlay();
      return;
    }
    syncOverlayOptions();
    overlay.updatePosition(anchor);
  }

  function hasUsableBounds(nextAnchor) {
    if (!nextAnchor || !nextAnchor.bounds) return false;
    return (
      Number.isFinite(nextAnchor.bounds.left) &&
      Number.isFinite(nextAnchor.bounds.top) &&
      Number.isFinite(nextAnchor.bounds.width) &&
      Number.isFinite(nextAnchor.bounds.height) &&
      nextAnchor.bounds.width > 0 &&
      nextAnchor.bounds.height > 0
    );
  }

  function fillZoneSelect(select, selectedValue) {
    var detected = utils.detectTimezone();
    var groups = utils.buildZoneOptionGroups(detected);
    var signature = selectedValue + "|" + detected + "|" + groups.map(function (g) {
      return g.label + ":" + g.zones.length;
    }).join(",");
    if (select.dataset.tspSignature === signature) {
      select.value = selectedValue;
      return;
    }
    select.dataset.tspSignature = signature;
    select.textContent = "";
    var found = false;
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      for (var i = 0; i < group.zones.length; i++) {
        var option = document.createElement("option");
        option.value = group.zones[i];
        option.textContent = formatZoneOptionLabel(group.zones[i]);
        if (group.zones[i] === selectedValue) {
          option.selected = true;
          found = true;
        }
        optgroup.appendChild(option);
      }
      select.appendChild(optgroup);
    }
    if (!found) {
      var fallbackGroup = document.createElement("optgroup");
      fallbackGroup.label = "Stored";
      var fallback = document.createElement("option");
      fallback.value = selectedValue;
      fallback.textContent = selectedValue;
      fallback.selected = true;
      fallbackGroup.appendChild(fallback);
      select.insertBefore(fallbackGroup, select.firstChild);
    }
  }

  function formatZoneOptionLabel(zone) {
    var label = utils.getZoneLabel(zone);
    var cityIdx = zone.lastIndexOf("/");
    var city = cityIdx === -1 ? zone : zone.slice(cityIdx + 1).replace(/_/g, " ");
    if (!label || label === zone) return city;
    return city + " (" + label + ")";
  }

  function renderDurationButtons() {
    for (var i = 0; i < durationButtons.length; i++) {
      durationButtons[i].classList.toggle("is-active", Number(durationButtons[i].dataset.duration) === state.lastDuration);
    }
  }

  function defineSectionFlag(key, open) {
    var update = {};
    update[key] = Boolean(open);
    return update;
  }

  function renderFolds() {
    Object.keys(detailsNodes).forEach(function (key) {
      var node = detailsNodes[key];
      if (!node) return;
      var desired = Boolean(state.uiSections && state.uiSections[key]);
      if (node.open !== desired) node.open = desired;
    });

    if (summaryNodes.timezones) {
      summaryNodes.timezones.textContent = describeTimezoneSummary();
    }
    if (summaryNodes.format) {
      summaryNodes.format.textContent = describeFormatSummary();
    }
  }

  function describeTimezoneSummary() {
    var calLabel = utils.getZoneLabel(state.calendarTimezone) || state.calendarTimezone;
    var outLabel = utils.getZoneLabel(state.outputTimezone) || state.outputTimezone;
    if (calLabel === outLabel) {
      return calLabel + (state.autoDetectTimezone === false ? " · manual" : "");
    }
    return calLabel + " → " + outLabel;
  }

  function describeFormatSummary() {
    var clock = state.formatOptions.clock === "24h" ? "24h" : "12h";
    var bits = [clock];
    if (state.formatOptions.includeDate === false) bits.push("no dates");
    if (state.formatOptions.includeZoneLabel === false) bits.push("no zone");
    if (state.formatOptions.excludePast === false) bits.push("incl. past");
    if (state.formatOptions.prefixMessage && state.formatOptions.prefixMessage.trim()) bits.push("prefix");
    return bits.join(" · ");
  }

  function renderFormatControls() {
    for (var i = 0; i < formatClockNodes.length; i++) {
      formatClockNodes[i].classList.toggle("is-active", formatClockNodes[i].dataset.clock === state.formatOptions.clock);
      formatClockNodes[i].setAttribute("aria-pressed", String(formatClockNodes[i].dataset.clock === state.formatOptions.clock));
    }
    if (formatIncludeDateNode) formatIncludeDateNode.checked = state.formatOptions.includeDate !== false;
    if (formatIncludeZoneNode) formatIncludeZoneNode.checked = state.formatOptions.includeZoneLabel !== false;
    if (formatExcludePastNode) formatExcludePastNode.checked = state.formatOptions.excludePast !== false;
    if (formatPrefixMessageNode && document.activeElement !== formatPrefixMessageNode) {
      formatPrefixMessageNode.value = state.formatOptions.prefixMessage || "";
    }
    if (autoDetectCheckbox) autoDetectCheckbox.checked = state.autoDetectTimezone !== false;
  }

  function formatSlotTime(iso, timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      hour: state.formatOptions.clock === "24h" ? "2-digit" : "numeric",
      minute: "2-digit",
      hour12: state.formatOptions.clock !== "24h"
    }).format(new Date(iso));
  }

  function formatSlotDayHeader(dateKey, timeZone) {
    var parts = dateKey.split("-").map(Number);
    var midday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0));
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(midday);
  }

  function computeSlotListSignature(selections, tz, clock) {
    var parts = [tz, clock, selections.length];
    for (var i = 0; i < selections.length; i++) {
      parts.push(selections[i].id + ":" + selections[i].startUTC + ":" + selections[i].endUTC);
    }
    return parts.join("|");
  }

  function renderSlotList() {
    if (!slotListNode) return;
    var selections = getSelections();
    var tz = state.outputTimezone;
    var clock = state.formatOptions.clock;
    var signature = computeSlotListSignature(selections, tz, clock);
    var nowMs = Date.now();
    var pastCount = 0;
    for (var s = 0; s < selections.length; s++) {
      var endMs = Date.parse(selections[s].endUTC);
      if (Number.isFinite(endMs) && endMs <= nowMs) pastCount++;
    }

    if (signature === slotListSignature && pastCount === slotListPastCount) {
      return pastCount;
    }
    slotListSignature = signature;
    slotListPastCount = pastCount;

    slotListNode.innerHTML = "";

    if (selections.length === 0) {
      var empty = document.createElement("div");
      empty.className = "tsp-slot-empty";
      empty.textContent = state.selectModeOn
        ? "Click any time on the grid to add a slot."
        : "Turn on Select Mode, then click the grid.";
      slotListNode.appendChild(empty);
      return 0;
    }

    var groups = utils.groupByDay(selections, tz);

    groups.forEach(function (slots, dateKey) {
      var header = document.createElement("div");
      header.className = "tsp-slot-day";
      header.textContent = formatSlotDayHeader(dateKey, tz);
      slotListNode.appendChild(header);

      for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        var slotEnd = Date.parse(slot.endUTC);
        var isPast = Number.isFinite(slotEnd) && slotEnd <= nowMs;
        var row = document.createElement("div");
        row.className = "tsp-slot-row" + (isPast ? " is-past" : "");

        var timeSpan = document.createElement("span");
        timeSpan.className = "tsp-slot-time";
        timeSpan.textContent = formatSlotTime(slot.startUTC, tz) + " – " + formatSlotTime(slot.endUTC, tz);

        var delBtn = document.createElement("button");
        delBtn.className = "tsp-slot-delete";
        delBtn.type = "button";
        delBtn.dataset.action = "delete-slot";
        delBtn.dataset.slotId = slot.id;
        delBtn.textContent = "×";
        delBtn.title = "Remove this slot";
        delBtn.setAttribute("aria-label", "Remove slot " + timeSpan.textContent);

        row.appendChild(timeSpan);
        row.appendChild(delBtn);
        slotListNode.appendChild(row);
      }
    });

    return pastCount;
  }

  function invalidateSlotListCache() {
    slotListSignature = null;
    slotListPastCount = -1;
  }

  function render() {
    if (!root || rendering) return;
    rendering = true;
    try {
      var selections = getSelections();
      var count = selections.length;

      outputNode.textContent = utils.formatOutput(selections, state.outputTimezone, state.formatOptions) || "No slots yet";
      modeButton.textContent = state.selectModeOn ? "Selecting..." : "Select Mode";
      modeButton.classList.toggle("is-active", state.selectModeOn);
      modeButton.setAttribute("aria-pressed", String(Boolean(state.selectModeOn)));
      root.classList.toggle("is-collapsed", !state.sidebarOpen);
      tabButton.textContent = count > 0 ? "Slots (" + count + ")" : "Slots";
      fillZoneSelect(calendarZoneSelect, state.calendarTimezone);
      fillZoneSelect(outputZoneSelect, state.outputTimezone);
      renderDurationButtons();
      renderFormatControls();
      renderFolds();
      var pastCount = renderSlotList();
      if (typeof pastCount !== "number") pastCount = slotListPastCount;
      if (clearPastButton) {
        clearPastButton.disabled = pastCount === 0;
        clearPastButton.textContent = pastCount > 0 ? "Clear past (" + pastCount + ")" : "Clear past";
      }
      if (copyButton) {
        copyButton.disabled = count === 0;
      }
      resetClearButton();
    } finally {
      rendering = false;
    }
  }

  function stopOverlay() {
    if (overlay) {
      try { overlay.destroy(); } catch (_e) { /* ensure cleanup */ }
      overlay = null;
    }
    Array.from(document.querySelectorAll(".tsp-capture-overlay")).forEach(function (orphan) {
      orphan.remove();
    });
  }

  function startOverlay() {
    stopOverlay();
    if (!shouldShowOverlay() || !anchor || !anchor.ok || !hasUsableBounds(anchor)) return;

    overlay = capture.createCaptureOverlay({
      anchor: anchor,
      durationMinutes: state.lastDuration,
      calendarTimezone: state.calendarTimezone,
      selections: getSelections(),
      captureEnabled: Boolean(state.selectModeOn),
      onSlot: function (slot) {
        var current = getSelections();
        if (current.length >= storage.MAX_SELECTIONS) {
          if (overlay) overlay.flash("conflict");
          setStatus("Max " + storage.MAX_SELECTIONS + " slots reached. Clear some first.", "error");
          return;
        }
        pushUndo();
        var result = utils.applySlotSelection(current, slot);
        if (result.action === "conflict") {
          undoStack.pop();
          if (overlay) overlay.flash("conflict");
          setStatus("That overlaps an existing slot.", "error");
          return;
        }
        setSelections(result.selections);
        if (overlay) overlay.flash("ok");
        setStatus(
          slot.clamped ? "Slot clamped to 12:00 AM." : result.action === "removed" ? "Slot removed." : "Slot added.",
          "ok"
        );
      },
      onError: function (message) {
        setStatus(message, "error");
      }
    });
  }

  function toggleSelectMode() {
    state = Object.assign({}, state, { selectModeOn: !state.selectModeOn });
    saveState();
    render();
    if (state.selectModeOn) {
      refreshAnchor();
    } else {
      syncOverlayState();
    }
  }

  function refreshAnchor() {
    anchor = gridAnchor.findGridAnchor(document);
    if (!anchor.ok) {
      stopOverlay();
      if (state.selectModeOn) {
        if (anchorFailureStartedAt === null) {
          anchorFailureStartedAt = Date.now();
        }
        if (Date.now() - anchorFailureStartedAt >= 5000) {
          state = Object.assign({}, state, { selectModeOn: false });
          saveState();
          render();
        }
      } else {
        anchorFailureStartedAt = null;
      }
      setStatus(anchor.reason + (state.selectModeOn ? " Retrying..." : " Switch to a week or day view."), "error");
      if (global.console && typeof gridAnchor.debugSnapshot === "function") {
        var debugWarnKey = anchor.reason + "|" + global.location.href;
        if (debugWarnKey !== lastDebugWarnKey) {
          lastDebugWarnKey = debugWarnKey;
          global.console.log("TSP grid detection failed:", gridAnchor.debugSnapshot(document));
        }
      }
      modeButton.disabled = true;
      return;
    }

    anchorFailureStartedAt = null;
    lastDebugWarnKey = null;
    if (!hasUsableBounds(anchor)) {
      stopOverlay();
      modeButton.disabled = true;
      setStatus(
        "Selectable calendar bounds not detected." + (state.selectModeOn ? " Retrying..." : " Switch to a week or day view."),
        "error"
      );
      return;
    }

    modeButton.disabled = false;
    var readyMessage = state.selectModeOn ? "Click the calendar grid to add or remove slots." : "Ready.";
    if (anchor.columnSource && anchor.columnSource !== "semantic") {
      readyMessage += " Using estimated columns.";
    }
    setStatus(readyMessage, "ok");
    syncOverlayState();
  }

  function resetClearButton() {
    if (!clearButton) return;
    clearButton.textContent = "Clear all";
    clearButton.classList.remove("is-confirm");
    global.clearTimeout(clearConfirmTimer);
  }

  function applyDetectedTimezone(announce) {
    var detected = utils.detectTimezone();
    if (!detected) return;

    // Explicit click ("Detect" button) snaps BOTH zones to detected — that's the
    // user asking for a hard reset. Implicit calls (focus listener, init) only
    // update the calendar zone so the user's manually-chosen output zone for
    // sharing isn't clobbered every time they alt-tab back.
    var snapOutput = Boolean(announce);
    var next = { calendarTimezone: detected };
    if (snapOutput || !utils.isValidTimezone(state.outputTimezone)) {
      next.outputTimezone = detected;
    }

    var unchanged = state.calendarTimezone === next.calendarTimezone &&
      (!("outputTimezone" in next) || state.outputTimezone === next.outputTimezone);
    if (unchanged) {
      if (announce) setStatus("Already on " + detected + ".", "neutral");
      return;
    }

    state = Object.assign({}, state, next);
    invalidateSlotListCache();
    saveState();
    render();
    syncOverlayState();
    if (announce) setStatus("Synced to " + detected + ".", "ok");
  }

  function buildSidebar() {
    var existing = document.getElementById("tsp-root");
    if (existing) existing.remove();

    root = document.createElement("aside");
    root.id = "tsp-root";
    root.setAttribute("aria-label", "Time Slot Picker");
    root.innerHTML = [
      '<div class="tsp-panel" role="region" aria-label="Time Slot Picker controls">',
      '  <div class="tsp-header">',
      '    <div class="tsp-header-text">',
      '      <span class="tsp-title">Time Slot Picker</span>',
      '    </div>',
      '    <button class="tsp-icon-button" type="button" data-action="collapse" title="Collapse sidebar" aria-label="Collapse sidebar">−</button>',
      '  </div>',
      '  <div class="tsp-status" data-kind="neutral" role="status" aria-live="polite">Starting...</div>',
      '  <div class="tsp-row tsp-duration-row">',
      '    <span class="tsp-label tsp-label-inline">Duration</span>',
      '    <div class="tsp-segments tsp-segments-compact" role="group" aria-label="Slot duration">',
      '      <button type="button" data-duration="15">15</button>',
      '      <button type="button" data-duration="30">30</button>',
      '      <button type="button" data-duration="45">45</button>',
      '      <button type="button" data-duration="60">60</button>',
      '    </div>',
      '  </div>',
      '  <button class="tsp-primary" type="button" data-action="toggle-mode" aria-pressed="false">Select Mode</button>',
      '  <details class="tsp-fold" data-section="timezones">',
      '    <summary><span class="tsp-fold-label">Timezones</span><span class="tsp-fold-summary" data-summary="timezones"></span></summary>',
      '    <div class="tsp-fold-body">',
      '      <div class="tsp-tz-header">',
      '        <span class="tsp-sublabel">Snap both zones to my browser</span>',
      '        <button type="button" class="tsp-link-button" data-action="detect-tz" title="Reset to my detected timezone">Detect</button>',
      '      </div>',
      '      <label class="tsp-tz-row">',
      '        <span class="tsp-sublabel">Calendar shows</span>',
      '        <select data-field="calendarTimezone" aria-label="Calendar timezone"></select>',
      '      </label>',
      '      <label class="tsp-tz-row">',
      '        <span class="tsp-sublabel">Copy as</span>',
      '        <select data-field="outputTimezone" aria-label="Output timezone"></select>',
      '      </label>',
      '      <label class="tsp-toggle">',
      '        <input type="checkbox" data-field="autoDetectTimezone">',
      '        <span>Auto-snap to my timezone</span>',
      '      </label>',
      '    </div>',
      '  </details>',
      '  <details class="tsp-fold" data-section="format">',
      '    <summary><span class="tsp-fold-label">Format</span><span class="tsp-fold-summary" data-summary="format"></span></summary>',
      '    <div class="tsp-fold-body">',
      '      <div class="tsp-segments tsp-segments-compact" role="group" aria-label="Time format">',
      '        <button type="button" data-clock="12h">12-hour</button>',
      '        <button type="button" data-clock="24h">24-hour</button>',
      '      </div>',
      '      <label class="tsp-toggle">',
      '        <input type="checkbox" data-field="includeDate">',
      '        <span>Include date headers</span>',
      '      </label>',
      '      <label class="tsp-toggle">',
      '        <input type="checkbox" data-field="includeZoneLabel">',
      '        <span>Include zone label</span>',
      '      </label>',
      '      <label class="tsp-toggle">',
      '        <input type="checkbox" data-field="excludePast">',
      '        <span>Hide past slots in copy</span>',
      '      </label>',
      '      <div>',
      '        <span class="tsp-sublabel">Message before slots</span>',
      '        <input type="text" class="tsp-prefix-input" data-field="prefixMessage" placeholder="e.g. Does a time work for you?" maxlength="500" autocomplete="off" spellcheck="false">',
      '      </div>',
      '    </div>',
      '  </details>',
      '  <div class="tsp-row tsp-slot-header">',
      '    <span class="tsp-label tsp-label-inline">Slots</span>',
      '    <button type="button" class="tsp-link-button" data-action="clear-past" title="Remove slots that have already ended">Clear past</button>',
      '  </div>',
      '  <div class="tsp-slot-list" role="list"></div>',
      '  <div class="tsp-output-wrap">',
      '    <pre class="tsp-output" tabindex="0" aria-label="Copy preview"></pre>',
      '  </div>',
      '  <div class="tsp-actions">',
      '    <button type="button" class="tsp-action-primary" data-action="copy">Copy</button>',
      '    <button type="button" data-action="undo" title="Undo last change" aria-label="Undo">↶</button>',
      '    <button type="button" data-action="clear" title="Clear all selections" aria-label="Clear all">Clear</button>',
      '  </div>',
      '  <details class="tsp-fold tsp-fold-quiet" data-section="shortcuts">',
      '    <summary><span class="tsp-fold-label">Shortcuts</span></summary>',
      '    <div class="tsp-shortcuts">',
      '      <span><kbd>Alt+S</kbd> select</span>',
      '      <span><kbd>Ctrl+Z</kbd> undo</span>',
      '      <span><kbd>Esc</kbd> exit</span>',
      '    </div>',
      '    <div class="tsp-debug-row">',
      '      <button type="button" class="tsp-debug-btn" data-action="copy-debug" title="Copy calibration + state JSON for diagnostics">Copy debug info</button>',
      '    </div>',
      '  </details>',
      '</div>',
      '<button class="tsp-tab" type="button" data-action="expand" aria-label="Expand Time Slot Picker">Slots</button>'
    ].join("\n");

    document.body.appendChild(root);
    statusNode = root.querySelector(".tsp-status");
    outputNode = root.querySelector(".tsp-output");
    slotListNode = root.querySelector(".tsp-slot-list");
    modeButton = root.querySelector("[data-action='toggle-mode']");
    clearButton = root.querySelector("[data-action='clear']");
    clearPastButton = root.querySelector("[data-action='clear-past']");
    detectTzButton = root.querySelector("[data-action='detect-tz']");
    copyButton = root.querySelector("[data-action='copy']");
    tabButton = root.querySelector("[data-action='expand']");
    calendarZoneSelect = root.querySelector("[data-field='calendarTimezone']");
    outputZoneSelect = root.querySelector("[data-field='outputTimezone']");
    autoDetectCheckbox = root.querySelector("[data-field='autoDetectTimezone']");
    formatIncludeDateNode = root.querySelector("[data-field='includeDate']");
    formatIncludeZoneNode = root.querySelector("[data-field='includeZoneLabel']");
    formatExcludePastNode = root.querySelector("[data-field='excludePast']");
    formatPrefixMessageNode = root.querySelector("[data-field='prefixMessage']");
    formatClockNodes = Array.from(root.querySelectorAll("[data-clock]"));
    durationButtons = Array.from(root.querySelectorAll("[data-duration]"));
    detailsNodes = {
      timezones: root.querySelector("details[data-section='timezones']"),
      format: root.querySelector("details[data-section='format']"),
      shortcuts: root.querySelector("details[data-section='shortcuts']")
    };
    summaryNodes = {
      timezones: root.querySelector("[data-summary='timezones']"),
      format: root.querySelector("[data-summary='format']")
    };

    Object.keys(detailsNodes).forEach(function (key) {
      var node = detailsNodes[key];
      if (!node) return;
      node.addEventListener("toggle", function () {
        if (rendering) return;
        state = Object.assign({}, state, {
          uiSections: Object.assign({}, state.uiSections, defineSectionFlag(key, node.open))
        });
        saveState();
      });
    });

    root.addEventListener("click", function (event) {
      var target = event.target.closest("button");
      if (!target) return;

      if (target.dataset.duration) {
        state = Object.assign({}, state, { lastDuration: Number(target.dataset.duration) });
        saveState();
        render();
        syncOverlayState();
      }

      if (target.dataset.clock) {
        var clock = target.dataset.clock === "24h" ? "24h" : "12h";
        state = Object.assign({}, state, {
          formatOptions: Object.assign({}, state.formatOptions, { clock: clock })
        });
        invalidateSlotListCache();
        saveState();
        render();
      }

      if (target.dataset.action === "toggle-mode") {
        toggleSelectMode();
      }

      if (target.dataset.action === "copy") {
        copyOutput();
      }

      if (target.dataset.action === "copy-debug") {
        copyDebugInfo();
      }

      if (target.dataset.action === "undo") {
        undo();
      }

      if (target.dataset.action === "delete-slot") {
        removeSlotById(target.dataset.slotId);
      }

      if (target.dataset.action === "clear-past") {
        clearPastSelections(true);
      }

      if (target.dataset.action === "detect-tz") {
        applyDetectedTimezone(true);
      }

      if (target.dataset.action === "clear") {
        if (target.classList.contains("is-confirm")) {
          global.clearTimeout(clearConfirmTimer);
          pushUndo();
          setSelections([]);
          setStatus("Selections cleared.", "ok");
        } else {
          target.textContent = "Sure?";
          target.classList.add("is-confirm");
          clearConfirmTimer = global.setTimeout(resetClearButton, 2000);
        }
      }

      if (target.dataset.action === "collapse") {
        state = Object.assign({}, state, { sidebarOpen: false });
        saveState();
        render();
      }

      if (target.dataset.action === "expand") {
        state = Object.assign({}, state, { sidebarOpen: true });
        saveState();
        render();
      }
    });

    root.addEventListener("change", function (event) {
      if (rendering) return;
      if (event.target === calendarZoneSelect) {
        state = Object.assign({}, state, { calendarTimezone: event.target.value });
        saveState();
        render();
        syncOverlayState();
      }
      if (event.target === outputZoneSelect) {
        state = Object.assign({}, state, { outputTimezone: event.target.value });
        invalidateSlotListCache();
        saveState();
        render();
      }
      if (event.target === autoDetectCheckbox) {
        state = Object.assign({}, state, { autoDetectTimezone: event.target.checked });
        saveState();
        if (state.autoDetectTimezone) {
          applyDetectedTimezone(false);
        }
      }
      if (event.target === formatIncludeDateNode) {
        state = Object.assign({}, state, {
          formatOptions: Object.assign({}, state.formatOptions, { includeDate: event.target.checked })
        });
        saveState();
        render();
      }
      if (event.target === formatIncludeZoneNode) {
        state = Object.assign({}, state, {
          formatOptions: Object.assign({}, state.formatOptions, { includeZoneLabel: event.target.checked })
        });
        saveState();
        render();
      }
      if (event.target === formatExcludePastNode) {
        state = Object.assign({}, state, {
          formatOptions: Object.assign({}, state.formatOptions, { excludePast: event.target.checked })
        });
        saveState();
        render();
      }
    });

    root.addEventListener("input", function (event) {
      if (rendering) return;
      if (event.target === formatPrefixMessageNode) {
        state = Object.assign({}, state, {
          formatOptions: Object.assign({}, state.formatOptions, { prefixMessage: event.target.value })
        });
        saveState();
        render();
      }
    });
  }

  function copyOutput() {
    var text = utils.formatOutput(getSelections(), state.outputTimezone, state.formatOptions);
    if (!text) {
      setStatus("No slots to copy.", "neutral");
      return;
    }

    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(
        function () { setStatus("Copied to clipboard.", "ok"); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function copyDebugInfo() {
    var snapshot = null;
    try {
      snapshot = global.TimeSlotPickerGridAnchor
        ? global.TimeSlotPickerGridAnchor.debugSnapshot()
        : null;
    } catch (error) {
      snapshot = { error: String(error && error.message || error) };
    }

    var payload = {
      capturedAtUTC: new Date().toISOString(),
      href: String(global.location && global.location.href || ""),
      viewport: {
        innerWidth: global.innerWidth,
        innerHeight: global.innerHeight,
        devicePixelRatio: global.devicePixelRatio
      },
      state: {
        calendarTimezone: state.calendarTimezone,
        outputTimezone: state.outputTimezone,
        lastDuration: state.lastDuration,
        selectModeOn: state.selectModeOn,
        autoDetectTimezone: state.autoDetectTimezone,
        formatOptions: state.formatOptions,
        selectionCount: getSelections().length,
        selections: getSelections()
      },
      anchorSnapshot: snapshot
    };

    var json = JSON.stringify(payload, null, 2);

    function announce(ok) {
      if (ok) {
        setStatus("Debug info copied to clipboard.", "ok");
      } else {
        try { (global.console && global.console.log)("[TimeSlotPicker debug]", payload); } catch (_e) {}
        setStatus("Couldn't reach clipboard — debug info logged to DevTools console.", "error");
      }
    }

    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(json).then(
        function () { announce(true); },
        function () { announce(false); }
      );
    } else {
      announce(false);
    }
  }

  function fallbackCopy(text) {
    outputNode.textContent = text;
    var range = document.createRange();
    range.selectNodeContents(outputNode);
    var selection = global.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    setStatus("Text selected — press Ctrl+C.", "neutral");
  }

  function handleUrlChange() {
    var nextScope = storage.getAccountScope(global.location.href);
    if (nextScope !== scope) {
      scope = nextScope;
      undoStack = [];
      render();
    }
    refreshAnchor();
  }

  var scrollRafPending = false;
  function onScrollThrottled() {
    if (scrollRafPending) return;
    scrollRafPending = true;
    global.requestAnimationFrame(function () {
      scrollRafPending = false;
      refreshAnchor();
    });
  }

  function handleKeyDown(event) {
    if (event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      toggleSelectMode();
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === "z" && state.selectModeOn) {
      event.preventDefault();
      undo();
      return;
    }

    if (event.key === "Escape" && state.selectModeOn) {
      event.preventDefault();
      state = Object.assign({}, state, { selectModeOn: false });
      saveState();
      render();
      syncOverlayState();
      setStatus("Select mode off.", "neutral");
    }
  }

  function handleFocus() {
    if (state.autoDetectTimezone !== false) {
      applyDetectedTimezone(false);
    }
  }

  function startGridTimers() {
    if (observersRunning) return;
    observersRunning = true;
    detectTimer = global.setInterval(refreshAnchor, GRID_REFRESH_INTERVAL_MS);
    urlTimer = global.setInterval(handleUrlChange, URL_REFRESH_INTERVAL_MS);
    pastStateTimer = global.setInterval(refreshPastState, 60000);
  }

  function stopGridTimers() {
    if (!observersRunning) return;
    observersRunning = false;
    global.clearInterval(detectTimer);
    global.clearInterval(urlTimer);
    global.clearInterval(pastStateTimer);
    detectTimer = null;
    urlTimer = null;
    pastStateTimer = null;
  }

  function refreshPastState() {
    // Slots that just ticked past should pick up strikethrough; cache key
    // includes pastCount, so a forced recount triggers a slot-list rebuild.
    invalidateSlotListCache();
    render();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      stopGridTimers();
    } else {
      refreshAnchor();
      handleUrlChange();
      refreshPastState();
      startGridTimers();
    }
  }

  function startObservers() {
    startGridTimers();
    global.addEventListener("resize", refreshAnchor);
    global.addEventListener("scroll", onScrollThrottled, true);
    global.addEventListener("keydown", handleKeyDown, true);
    global.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  function wireChromeMessages() {
    if (!global.chrome || !global.chrome.runtime || !global.chrome.runtime.onMessage) return;
    if (chromeMessagesWired) return;
    chromeMessagesWired = true;

    global.chrome.runtime.onMessage.addListener(function (message) {
      if (message && message.type === "TSP_TOGGLE_SIDEBAR") {
        if (!root) {
          pendingShowSidebar = true;
          return;
        }
        state = Object.assign({}, state, { sidebarOpen: !state.sidebarOpen });
        saveState();
        render();
      }
      if (message && message.type === "TSP_SHOW_SIDEBAR") {
        if (!root) {
          pendingShowSidebar = true;
          return;
        }
        state = Object.assign({}, state, { sidebarOpen: true });
        saveState();
        render();
      }
    });

    if (global.chrome.storage && global.chrome.storage.onChanged) {
      global.chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== "local" || !changes[storage.STORAGE_KEY]) return;
        var incoming = changes[storage.STORAGE_KEY].newValue;
        var incomingSnapshot = serializeStateSnapshot(incoming);
        if (incomingSnapshot && incomingSnapshot === pendingWriteToken) {
          return;
        }
        state = storage.normalizeState(incoming);
        render();
        syncOverlaySelections();
      });
    }
  }

  function init() {
    wireChromeMessages();
    storage.readState(function (loaded) {
      state = loaded;
      var shouldPersistPendingShow = pendingShowSidebar;
      if (pendingShowSidebar) {
        state = Object.assign({}, state, { sidebarOpen: true });
        pendingShowSidebar = false;
      }
      if (state.autoDetectTimezone !== false) {
        var detected = utils.detectTimezone();
        if (detected && (!utils.isValidTimezone(state.calendarTimezone) || state.calendarTimezone !== detected)) {
          state = Object.assign({}, state, {
            calendarTimezone: detected,
            outputTimezone: utils.isValidTimezone(state.outputTimezone) ? state.outputTimezone : detected
          });
        }
      }
      // If the user's zones disagree (e.g., sharing across timezones) open the
      // Timezones fold so they can see what's going on without hunting.
      if (state.calendarTimezone !== state.outputTimezone && !state.uiSections.timezones) {
        state = Object.assign({}, state, {
          uiSections: Object.assign({}, state.uiSections, { timezones: true })
        });
      }
      scope = storage.getAccountScope(global.location.href);
      if (typeof gridAnchor.debugSnapshot === "function") {
        global.TimeSlotPickerDebug = function () {
          return gridAnchor.debugSnapshot(document);
        };
      }
      buildSidebar();
      if (shouldPersistPendingShow) {
        saveState();
      }
      var pruneResult = storage.pruneStaleFromState(state, Date.now());
      if (pruneResult.removedCount > 0) {
        state = pruneResult.state;
        saveState();
      }
      render();
      refreshAnchor();
      startObservers();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
