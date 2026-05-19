(function attachStorage(global) {
  "use strict";

  var STORAGE_KEY = "timeSlotPicker";
  var MAX_SELECTIONS = 200;
  var ALLOWED_DURATIONS = [15, 30, 45, 60];

  function isValidTimezone(timeZone) {
    if (typeof timeZone !== "string" || timeZone.length === 0) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timeZone }).format(new Date());
      return true;
    } catch (_error) {
      return false;
    }
  }

  function getDetectedTimezone() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return isValidTimezone(zone) ? zone : "UTC";
    } catch (_error) {
      return "UTC";
    }
  }

  function getAccountScope(url) {
    var match = String(url || "").match(/\/u\/(\d+)(?:\/|$)/);
    return match ? "u/" + match[1] : "default";
  }

  function isValidSlot(slot) {
    if (!slot || typeof slot !== "object") return false;
    if (typeof slot.id !== "string" || slot.id.length === 0) return false;
    if (typeof slot.startUTC !== "string" || typeof slot.endUTC !== "string") return false;
    var start = Date.parse(slot.startUTC);
    var end = Date.parse(slot.endUTC);
    if (isNaN(start) || isNaN(end) || end <= start) return false;
    return true;
  }

  function sanitizeSelections(raw) {
    if (!Array.isArray(raw)) return [];
    var seenIds = Object.create(null);
    var clean = [];
    for (var i = 0; i < raw.length && clean.length < MAX_SELECTIONS; i++) {
      var slot = raw[i];
      if (!isValidSlot(slot) || seenIds[slot.id]) continue;
      seenIds[slot.id] = true;
      clean.push(slot);
    }
    return clean;
  }

  function defaultFormatOptions() {
    return {
      clock: "12h",
      includeDate: true,
      includeZoneLabel: true,
      excludePast: true,
      prefixMessage: ""
    };
  }

  function defaultUiSections() {
    return {
      timezones: false,
      format: false,
      shortcuts: false
    };
  }

  function sanitizeUiSections(raw) {
    var base = defaultUiSections();
    if (!raw || typeof raw !== "object") return base;
    base.timezones = raw.timezones === true;
    base.format = raw.format === true;
    base.shortcuts = raw.shortcuts === true;
    return base;
  }

  function sanitizeFormatOptions(raw) {
    var base = defaultFormatOptions();
    if (!raw || typeof raw !== "object") return base;
    if (raw.clock === "12h" || raw.clock === "24h") base.clock = raw.clock;
    if (raw.includeDate === false) base.includeDate = false;
    if (raw.includeZoneLabel === false) base.includeZoneLabel = false;
    if (raw.excludePast === false) base.excludePast = false;
    if (typeof raw.prefixMessage === "string") base.prefixMessage = raw.prefixMessage.slice(0, 500);
    return base;
  }

  function createDefaultState(timeZone) {
    var zone = timeZone && isValidTimezone(timeZone) ? timeZone : getDetectedTimezone();
    return {
      accountScopes: {},
      calendarTimezone: zone,
      outputTimezone: zone,
      lastDuration: 30,
      sidebarOpen: true,
      selectModeOn: false,
      autoDetectTimezone: true,
      formatOptions: defaultFormatOptions(),
      uiSections: defaultUiSections()
    };
  }

  function normalizeState(raw, timeZone) {
    var base = createDefaultState(timeZone);
    var merged = Object.assign({}, base, raw || {});
    merged.accountScopes = (raw && raw.accountScopes) || {};

    if (!isValidTimezone(merged.calendarTimezone)) merged.calendarTimezone = base.calendarTimezone;
    if (!isValidTimezone(merged.outputTimezone)) merged.outputTimezone = base.outputTimezone;

    var scopes = merged.accountScopes;
    for (var key in scopes) {
      if (scopes.hasOwnProperty(key) && scopes[key] && scopes[key].selections) {
        scopes[key] = Object.assign({}, scopes[key], {
          selections: sanitizeSelections(scopes[key].selections)
        });
      }
    }

    if (ALLOWED_DURATIONS.indexOf(merged.lastDuration) === -1) {
      merged.lastDuration = 30;
    }

    merged.autoDetectTimezone = merged.autoDetectTimezone !== false;
    merged.sidebarOpen = merged.sidebarOpen !== false;
    merged.selectModeOn = Boolean(merged.selectModeOn);
    merged.formatOptions = sanitizeFormatOptions(merged.formatOptions);
    merged.uiSections = sanitizeUiSections(merged.uiSections);

    return merged;
  }

  function pruneStaleFromState(state, nowMs) {
    if (!state || !state.accountScopes) return { state: state, removedCount: 0 };
    var cutoff = typeof nowMs === "number" ? nowMs : Date.now();
    var totalRemoved = 0;
    var nextScopes = {};
    for (var key in state.accountScopes) {
      if (!state.accountScopes.hasOwnProperty(key)) continue;
      var scoped = state.accountScopes[key] || {};
      var current = Array.isArray(scoped.selections) ? scoped.selections : [];
      var kept = [];
      for (var i = 0; i < current.length; i++) {
        var end = Date.parse(current[i].endUTC);
        if (Number.isFinite(end) && end <= cutoff) {
          totalRemoved++;
        } else {
          kept.push(current[i]);
        }
      }
      nextScopes[key] = Object.assign({}, scoped, { selections: kept });
    }
    return {
      state: Object.assign({}, state, { accountScopes: nextScopes }),
      removedCount: totalRemoved
    };
  }

  function getSelectionsForScope(state, scope) {
    var scoped = state.accountScopes && state.accountScopes[scope];
    return ((scoped && scoped.selections) || []).slice();
  }

  function setSelectionsForScope(state, scope, selections) {
    var capped = selections.slice(0, MAX_SELECTIONS);
    var existing = (state.accountScopes && state.accountScopes[scope]) || {};
    var newScope = Object.assign({}, existing, { selections: capped });
    var newScopes = Object.assign({}, state.accountScopes || {});
    newScopes[scope] = newScope;
    return Object.assign({}, state, { accountScopes: newScopes });
  }

  function readState(callback) {
    if (!global.chrome || !global.chrome.storage || !global.chrome.storage.local) {
      callback(normalizeState(null));
      return;
    }

    try {
      global.chrome.storage.local.get(STORAGE_KEY, function (result) {
        if (global.chrome.runtime.lastError) {
          callback(normalizeState(null));
          return;
        }
        callback(normalizeState(result && result[STORAGE_KEY]));
      });
    } catch (_e) {
      callback(normalizeState(null));
    }
  }

  function writeState(state, callback) {
    if (!global.chrome || !global.chrome.storage || !global.chrome.storage.local) {
      if (callback) callback(null);
      return;
    }

    try {
      var payload = {};
      payload[STORAGE_KEY] = state;
      global.chrome.storage.local.set(payload, function () {
        var error = global.chrome.runtime.lastError;
        if (error) {
          console.warn("TSP: storage write failed:", error.message);
        }
        if (callback) callback(error || null);
      });
    } catch (e) {
      console.warn("TSP: storage write threw:", e);
      if (callback) callback(e);
    }
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_SELECTIONS: MAX_SELECTIONS,
    ALLOWED_DURATIONS: ALLOWED_DURATIONS,
    createDefaultState: createDefaultState,
    getAccountScope: getAccountScope,
    getDetectedTimezone: getDetectedTimezone,
    getSelectionsForScope: getSelectionsForScope,
    isValidSlot: isValidSlot,
    isValidTimezone: isValidTimezone,
    normalizeState: normalizeState,
    pruneStaleFromState: pruneStaleFromState,
    readState: readState,
    sanitizeFormatOptions: sanitizeFormatOptions,
    sanitizeSelections: sanitizeSelections,
    sanitizeUiSections: sanitizeUiSections,
    setSelectionsForScope: setSelectionsForScope,
    writeState: writeState
  };

  global.TimeSlotPickerStorage = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
