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

  var COMMON_ZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "UTC",
    "Europe/London",
    "Europe/Paris",
    "Asia/Tokyo"
  ];

  var state = storage.createDefaultState();
  var scope = storage.getAccountScope(global.location.href);
  var anchor = null;
  var overlay = null;
  var root = null;
  var statusNode = null;
  var outputNode = null;
  var slotListNode = null;
  var scopeNode = null;
  var modeButton = null;
  var clearButton = null;
  var tabButton = null;
  var calendarZoneSelect = null;
  var outputZoneSelect = null;
  var durationButtons = [];
  var detectTimer = null;
  var urlTimer = null;
  var saveTimer = null;
  var clearConfirmTimer = null;
  var undoStack = [];
  var rendering = false;

  function getSelections() {
    return storage.getSelectionsForScope(state, scope);
  }

  function saveState() {
    global.clearTimeout(saveTimer);
    saveTimer = global.setTimeout(function () { storage.writeState(state); }, 120);
  }

  function setStatus(message, kind) {
    if (!statusNode) return;
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
    saveState();
    render();
    syncOverlaySelections();
    setStatus("Undone.", "ok");
  }

  function setSelections(selections) {
    state = storage.setSelectionsForScope(state, scope, selections);
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

  function syncOverlaySelections() {
    if (overlay) overlay.updateSelections(getSelections());
  }

  function zoneOptions() {
    var detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    var supported = typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
    return Array.from(new Set([detected].concat(COMMON_ZONES, supported))).filter(Boolean);
  }

  function fillZoneSelect(select, selectedValue) {
    if (select.value === selectedValue && select.options.length > 0) return;
    select.textContent = "";
    var zones = zoneOptions();
    for (var i = 0; i < zones.length; i++) {
      var option = document.createElement("option");
      option.value = zones[i];
      option.textContent = zones[i];
      option.selected = zones[i] === selectedValue;
      select.appendChild(option);
    }
  }

  function renderDurationButtons() {
    for (var i = 0; i < durationButtons.length; i++) {
      durationButtons[i].classList.toggle("is-active", Number(durationButtons[i].dataset.duration) === state.lastDuration);
    }
  }

  function formatSlotTime(iso, timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      hour: "numeric",
      minute: "2-digit"
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

  function renderSlotList() {
    if (!slotListNode) return;
    var selections = getSelections();
    slotListNode.innerHTML = "";

    if (selections.length === 0) {
      var empty = document.createElement("div");
      empty.className = "tsp-slot-empty";
      empty.textContent = "No slots selected.";
      slotListNode.appendChild(empty);
      return;
    }

    var tz = state.outputTimezone;
    var groups = utils.groupByDay(selections, tz);

    groups.forEach(function (slots, dateKey) {
      var header = document.createElement("div");
      header.className = "tsp-slot-day";
      header.textContent = formatSlotDayHeader(dateKey, tz);
      slotListNode.appendChild(header);

      for (var i = 0; i < slots.length; i++) {
        var slot = slots[i];
        var row = document.createElement("div");
        row.className = "tsp-slot-row";

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

        row.appendChild(timeSpan);
        row.appendChild(delBtn);
        slotListNode.appendChild(row);
      }
    });
  }

  function render() {
    if (!root || rendering) return;
    rendering = true;
    try {
      var selections = getSelections();
      var count = selections.length;

      scopeNode.textContent = "Calendar: " + scope;
      outputNode.textContent = utils.formatOutput(selections, state.outputTimezone) || "No slots selected.";
      modeButton.textContent = state.selectModeOn ? "Selecting..." : "Select Mode";
      modeButton.classList.toggle("is-active", state.selectModeOn);
      root.classList.toggle("is-collapsed", !state.sidebarOpen);
      tabButton.textContent = count > 0 ? "Slots (" + count + ")" : "Slots";
      fillZoneSelect(calendarZoneSelect, state.calendarTimezone);
      fillZoneSelect(outputZoneSelect, state.outputTimezone);
      renderDurationButtons();
      renderSlotList();
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
    var orphan = document.querySelector(".tsp-capture-overlay");
    if (orphan) orphan.remove();
  }

  function startOverlay() {
    stopOverlay();
    if (!anchor || !anchor.ok) return;

    overlay = capture.createCaptureOverlay({
      anchor: anchor,
      durationMinutes: state.lastDuration,
      calendarTimezone: state.calendarTimezone,
      selections: getSelections(),
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
    state.selectModeOn ? refreshAnchor() : stopOverlay();
  }

  function refreshAnchor() {
    anchor = gridAnchor.findGridAnchor(document);
    if (!anchor.ok) {
      if (state.selectModeOn) {
        state = Object.assign({}, state, { selectModeOn: false });
        saveState();
        stopOverlay();
        render();
      }
      setStatus(anchor.reason + " Switch to a week or day view.", "error");
      modeButton.disabled = true;
      return;
    }

    modeButton.disabled = false;
    setStatus(state.selectModeOn ? "Click the calendar grid to add or remove slots." : "Ready.", "ok");
    if (state.selectModeOn) {
      if (overlay) {
        overlay.updatePosition(anchor);
      } else {
        startOverlay();
      }
    }
  }

  function resetClearButton() {
    if (!clearButton) return;
    clearButton.textContent = "Clear";
    clearButton.classList.remove("is-confirm");
    global.clearTimeout(clearConfirmTimer);
  }

  function buildSidebar() {
    var existing = document.getElementById("tsp-root");
    if (existing) existing.remove();

    root = document.createElement("aside");
    root.id = "tsp-root";
    root.innerHTML = [
      '<div class="tsp-panel">',
      '  <div class="tsp-header">',
      '    <div>',
      '      <div class="tsp-title">Time Slot Picker</div>',
      '      <div class="tsp-scope"></div>',
      '    </div>',
      '    <button class="tsp-icon-button" type="button" data-action="collapse" title="Collapse">−</button>',
      '  </div>',
      '  <div class="tsp-status" data-kind="neutral">Starting...</div>',
      '  <div class="tsp-section">',
      '    <div class="tsp-label">Duration (min)</div>',
      '    <div class="tsp-segments">',
      '      <button type="button" data-duration="15">15</button>',
      '      <button type="button" data-duration="30">30</button>',
      '      <button type="button" data-duration="45">45</button>',
      '      <button type="button" data-duration="60">60</button>',
      '    </div>',
      '  </div>',
      '  <div class="tsp-section">',
      '    <button class="tsp-primary" type="button" data-action="toggle-mode">Select Mode</button>',
      '    <span class="tsp-hint">Alt+S</span>',
      '  </div>',
      '  <label class="tsp-section">',
      '    <span class="tsp-label">Calendar timezone</span>',
      '    <select data-field="calendarTimezone"></select>',
      '  </label>',
      '  <label class="tsp-section">',
      '    <span class="tsp-label">Copy timezone</span>',
      '    <select data-field="outputTimezone"></select>',
      '  </label>',
      '  <div class="tsp-section">',
      '    <div class="tsp-label">Selected slots</div>',
      '    <div class="tsp-slot-list"></div>',
      '  </div>',
      '  <div class="tsp-section tsp-output-wrap">',
      '    <div class="tsp-label">Copy preview</div>',
      '    <pre class="tsp-output" tabindex="0"></pre>',
      '  </div>',
      '  <div class="tsp-actions">',
      '    <button type="button" data-action="copy">Copy</button>',
      '    <button type="button" data-action="undo">Undo</button>',
      '    <button type="button" data-action="clear">Clear</button>',
      '  </div>',
      '  <div class="tsp-shortcuts">',
      '    <span><kbd>Alt+S</kbd> select</span>',
      '    <span><kbd>Ctrl+Z</kbd> undo</span>',
      '  </div>',
      '</div>',
      '<button class="tsp-tab" type="button" data-action="expand">Slots</button>'
    ].join("\n");

    document.body.appendChild(root);
    statusNode = root.querySelector(".tsp-status");
    outputNode = root.querySelector(".tsp-output");
    slotListNode = root.querySelector(".tsp-slot-list");
    scopeNode = root.querySelector(".tsp-scope");
    modeButton = root.querySelector("[data-action='toggle-mode']");
    clearButton = root.querySelector("[data-action='clear']");
    tabButton = root.querySelector("[data-action='expand']");
    calendarZoneSelect = root.querySelector("[data-field='calendarTimezone']");
    outputZoneSelect = root.querySelector("[data-field='outputTimezone']");
    durationButtons = Array.from(root.querySelectorAll("[data-duration]"));

    root.addEventListener("click", function (event) {
      var target = event.target.closest("button");
      if (!target) return;

      if (target.dataset.duration) {
        state = Object.assign({}, state, { lastDuration: Number(target.dataset.duration) });
        saveState();
        render();
        if (state.selectModeOn) startOverlay();
      }

      if (target.dataset.action === "toggle-mode") {
        toggleSelectMode();
      }

      if (target.dataset.action === "copy") {
        copyOutput();
      }

      if (target.dataset.action === "undo") {
        undo();
      }

      if (target.dataset.action === "delete-slot") {
        removeSlotById(target.dataset.slotId);
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
        if (state.selectModeOn) startOverlay();
      }
      if (event.target === outputZoneSelect) {
        state = Object.assign({}, state, { outputTimezone: event.target.value });
        saveState();
        render();
      }
    });
  }

  function copyOutput() {
    var text = utils.formatOutput(getSelections(), state.outputTimezone);
    if (!text) {
      setStatus("No slots to copy.", "neutral");
      return;
    }

    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(
        function () { setStatus("Copied.", "ok"); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
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
  }

  function startObservers() {
    detectTimer = global.setInterval(refreshAnchor, 2500);
    urlTimer = global.setInterval(handleUrlChange, 1000);
    global.addEventListener("resize", refreshAnchor);
    global.addEventListener("scroll", onScrollThrottled, true);
    global.addEventListener("keydown", handleKeyDown, true);
  }

  function wireChromeMessages() {
    if (!global.chrome || !global.chrome.runtime || !global.chrome.runtime.onMessage) return;

    global.chrome.runtime.onMessage.addListener(function (message) {
      if (message && message.type === "TSP_TOGGLE_SIDEBAR") {
        state = Object.assign({}, state, { sidebarOpen: !state.sidebarOpen });
        saveState();
        render();
      }
    });

    if (global.chrome.storage && global.chrome.storage.onChanged) {
      global.chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== "local" || !changes[storage.STORAGE_KEY]) return;
        state = storage.normalizeState(changes[storage.STORAGE_KEY].newValue);
        render();
        syncOverlaySelections();
      });
    }
  }

  function init() {
    storage.readState(function (loaded) {
      state = loaded;
      scope = storage.getAccountScope(global.location.href);
      buildSidebar();
      wireChromeMessages();
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
