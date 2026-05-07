(function attachStorage(global) {
  "use strict";

  var STORAGE_KEY = "timeSlotPicker";
  var MAX_SELECTIONS = 200;

  function getDetectedTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
    return raw.filter(isValidSlot).slice(0, MAX_SELECTIONS);
  }

  function createDefaultState(timeZone) {
    var zone = timeZone || getDetectedTimezone();
    return {
      accountScopes: {},
      calendarTimezone: zone,
      outputTimezone: zone,
      lastDuration: 30,
      sidebarOpen: true,
      selectModeOn: false
    };
  }

  function normalizeState(raw, timeZone) {
    var base = createDefaultState(timeZone);
    var merged = Object.assign({}, base, raw || {});
    merged.accountScopes = (raw && raw.accountScopes) || {};

    var scopes = merged.accountScopes;
    for (var key in scopes) {
      if (scopes.hasOwnProperty(key) && scopes[key] && scopes[key].selections) {
        scopes[key] = Object.assign({}, scopes[key], {
          selections: sanitizeSelections(scopes[key].selections)
        });
      }
    }

    if ([15, 30, 45, 60].indexOf(merged.lastDuration) === -1) {
      merged.lastDuration = 30;
    }

    return merged;
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
      if (callback) callback();
      return;
    }

    try {
      var payload = {};
      payload[STORAGE_KEY] = state;
      global.chrome.storage.local.set(payload, function () {
        if (global.chrome.runtime.lastError) {
          console.warn("TSP: storage write failed:", global.chrome.runtime.lastError.message);
        }
        if (callback) callback();
      });
    } catch (_e) {
      console.warn("TSP: storage write threw:", _e);
      if (callback) callback();
    }
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_SELECTIONS: MAX_SELECTIONS,
    createDefaultState: createDefaultState,
    getAccountScope: getAccountScope,
    getSelectionsForScope: getSelectionsForScope,
    isValidSlot: isValidSlot,
    normalizeState: normalizeState,
    readState: readState,
    setSelectionsForScope: setSelectionsForScope,
    writeState: writeState
  };

  global.TimeSlotPickerStorage = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
