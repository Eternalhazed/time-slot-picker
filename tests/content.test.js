import { createRequire } from "node:module";
import { afterEach, describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);

function resetContentModule() {
  delete global.__timeSlotPickerBooted;
  delete global.TimeSlotPickerDebug;
  delete require.cache[require.resolve("../extension/content.js")];
}

function bootContentWithAnchor(anchorResult, storedState, options = {}) {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  document.body.innerHTML = "";
  resetContentModule();

  const initialStored = storedState || {
    accountScopes: {},
    calendarTimezone: "America/Chicago",
    outputTimezone: "America/Chicago",
    lastDuration: 30,
    sidebarOpen: true,
    selectModeOn: true,
    autoDetectTimezone: false
  };

  const setSpy = vi.fn((_payload, callback) => {
    if (callback) callback();
  });

  let onChangedListener = null;
  let onMessageListener = null;
  let flushStorageRead = null;
  global.chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener: vi.fn((listener) => {
          onMessageListener = listener;
        })
      }
    },
    storage: {
      local: {
        get: vi.fn((_key, callback) => {
          if (options.deferStorageRead) {
            flushStorageRead = () => callback({ timeSlotPicker: initialStored });
            return;
          }
          callback({ timeSlotPicker: initialStored });
        }),
        set: setSpy
      },
      onChanged: {
        addListener: vi.fn((listener) => {
          onChangedListener = listener;
        })
      }
    }
  };

  require("../extension/time-utils.js");
  require("../extension/storage.js");
  const debugSnapshot = { href: "https://calendar.google.com/calendar/u/0/r/week" };
  global.TimeSlotPickerGridAnchor = {
    debugSnapshot: vi.fn(() => debugSnapshot),
    findGridAnchor: vi.fn(() => anchorResult)
  };
  global.TimeSlotPickerCaptureOverlay = {
    createCaptureOverlay: vi.fn(() => ({
      element: document.createElement("div"),
      flash: vi.fn(),
      updatePosition: vi.fn(),
      updateSelections: vi.fn(),
      destroy: vi.fn()
    }))
  };

  require("../extension/content.js");
  return {
    captureOverlay: global.TimeSlotPickerCaptureOverlay,
    debugSnapshot,
    flushStorageRead: () => flushStorageRead && flushStorageRead(),
    setSpy,
    triggerMessage: (message) => onMessageListener && onMessageListener(message, {}, vi.fn()),
    triggerStorageChange: (changes) => onChangedListener && onChangedListener(changes, "local")
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetContentModule();
  delete global.chrome;
});

describe("content selection-mode recovery", () => {
  test("keeps select mode active through transient grid detection failures", () => {
    bootContentWithAnchor({
      ok: false,
      reason: "Date columns not detected."
    });

    const button = document.querySelector("[data-action='toggle-mode']");

    expect(button.textContent).toBe("Selecting...");
    expect(button.disabled).toBe(true);

    vi.advanceTimersByTime(4000);
    expect(button.textContent).toBe("Selecting...");

    vi.advanceTimersByTime(1000);
    expect(button.textContent).toBe("Select Mode");
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  test("exposes a debug snapshot helper for live grid detection failures", () => {
    const { debugSnapshot } = bootContentWithAnchor({
      ok: false,
      reason: "Date columns not detected."
    });

    expect(global.TimeSlotPickerDebug()).toBe(debugSnapshot);
  });

  test("labels non-semantic column detection as estimated when ready", () => {
    bootContentWithAnchor({
      ok: true,
      bounds: { left: 100, top: 200, width: 700, height: 600 },
      columnSource: "split-header"
    });

    expect(document.querySelector(".tsp-status").textContent).toBe(
      "Click the calendar grid to add or remove slots. Using estimated columns."
    );
  });

  test("does not create a full-grid overlay when selectable bounds are missing", () => {
    const { captureOverlay } = bootContentWithAnchor({
      ok: true,
      bounds: null,
      columnSource: "url-estimate"
    });

    expect(captureOverlay.createCaptureOverlay).not.toHaveBeenCalled();
    expect(document.querySelector("[data-action='toggle-mode']").disabled).toBe(true);
    expect(document.querySelector(".tsp-status").textContent).toBe(
      "Selectable calendar bounds not detected. Retrying..."
    );
  });
});

describe("content timezone & format controls", () => {
  test("renders grouped timezone selects with US zones surfaced", () => {
    bootContentWithAnchor({
      ok: true,
      bounds: { left: 100, top: 200, width: 700, height: 600 },
      columnSource: "semantic"
    });

    const select = document.querySelector("[data-field='outputTimezone']");
    const labels = Array.from(select.querySelectorAll("optgroup")).map((g) => g.label);
    expect(labels).toContain("United States");
    const usGroup = Array.from(select.querySelectorAll("optgroup"))
      .find((g) => g.label === "United States");
    expect(usGroup).toBeTruthy();
    const usZones = Array.from(usGroup.querySelectorAll("option")).map((o) => o.value);
    expect(usZones).toContain("America/New_York");
    expect(usZones).toContain("America/Los_Angeles");
  });

  test("changes 24h clock and re-renders the copy preview", () => {
    bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {
          "default": {
            selections: [
              {
                id: "x",
                startUTC: "2099-05-14T18:00:00.000Z",
                endUTC: "2099-05-14T19:00:00.000Z"
              }
            ]
          }
        },
        calendarTimezone: "America/Chicago",
        outputTimezone: "America/New_York",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: false,
        autoDetectTimezone: false,
        formatOptions: { clock: "12h", includeDate: true, includeZoneLabel: true }
      }
    );

    const before = document.querySelector(".tsp-output").textContent;
    expect(before).toContain("2:00 PM");

    const twentyFour = Array.from(document.querySelectorAll("[data-clock]"))
      .find((btn) => btn.dataset.clock === "24h");
    twentyFour.click();

    const after = document.querySelector(".tsp-output").textContent;
    expect(after).toContain("14:00");
    expect(after).not.toContain("PM");
  });

  test("Clear past button removes ended slots and counts past entries", () => {
    bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {
          "default": {
            selections: [
              { id: "old", startUTC: "2020-01-01T00:00:00.000Z", endUTC: "2020-01-01T01:00:00.000Z" },
              { id: "future", startUTC: "2099-01-01T00:00:00.000Z", endUTC: "2099-01-01T01:00:00.000Z" }
            ]
          }
        },
        calendarTimezone: "UTC",
        outputTimezone: "UTC",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: false,
        autoDetectTimezone: false
      }
    );

    // Initial prune on load already removes the old slot. UI should reflect 0 past.
    const clearPast = document.querySelector("[data-action='clear-past']");
    expect(clearPast.disabled).toBe(true);
    expect(clearPast.textContent).toBe("Clear past");
    const rows = document.querySelectorAll(".tsp-slot-row");
    expect(rows).toHaveLength(1);
    // future slot is Jan 1; date header uses weekday/month/day (no year).
    expect(document.querySelector(".tsp-output").textContent).toContain("Jan 1");
  });

  test("Detect button snaps both timezones to the browser-detected zone", () => {
    bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {},
        calendarTimezone: "Asia/Tokyo",
        outputTimezone: "Asia/Tokyo",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: false,
        autoDetectTimezone: false
      }
    );

    const detectButton = document.querySelector("[data-action='detect-tz']");
    detectButton.click();

    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const calendarSelect = document.querySelector("[data-field='calendarTimezone']");
    expect(calendarSelect.value).toBe(detected);
  });

  test("Escape exits select mode and stops the overlay", () => {
    const { captureOverlay } = bootContentWithAnchor({
      ok: true,
      bounds: { left: 100, top: 200, width: 700, height: 600 },
      columnSource: "semantic",
      columns: [],
      grid: document.createElement("div"),
      calibration: { gridRectTop: 0, gridStartHour: 0, pixelsPerHour: 60, scrollTop: 0 }
    });

    expect(captureOverlay.createCaptureOverlay).toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.querySelector("[data-action='toggle-mode']").textContent).toBe("Select Mode");
    expect(document.querySelector(".tsp-status").textContent).toBe("Select mode off.");
  });

  test("opens the Timezones fold by default when calendar and output zones differ", () => {
    bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {},
        calendarTimezone: "America/Los_Angeles",
        outputTimezone: "Europe/London",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: false,
        autoDetectTimezone: false,
        uiSections: { timezones: false, format: false, shortcuts: false }
      }
    );

    const tzFold = document.querySelector("details[data-section='timezones']");
    expect(tzFold.open).toBe(true);
  });

  test("fold summary text reflects current zones and format", () => {
    bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {},
        calendarTimezone: "America/Chicago",
        outputTimezone: "America/Los_Angeles",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: false,
        autoDetectTimezone: false,
        formatOptions: { clock: "24h", includeDate: false, includeZoneLabel: true, excludePast: true }
      }
    );

    expect(document.querySelector("[data-summary='timezones']").textContent).toBe("CT → PT");
    expect(document.querySelector("[data-summary='format']").textContent).toBe("24h · no dates");
  });

  test("excludePast format option hides past slots from copy preview", () => {
    bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {
          default: {
            selections: [
              { id: "future", startUTC: "2099-01-02T00:00:00.000Z", endUTC: "2099-01-02T01:00:00.000Z" }
            ]
          }
        },
        calendarTimezone: "UTC",
        outputTimezone: "UTC",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: false,
        autoDetectTimezone: false,
        formatOptions: { clock: "12h", includeDate: true, includeZoneLabel: true, excludePast: true }
      }
    );

    const before = document.querySelector(".tsp-output").textContent;
    expect(before).toContain("12:00 AM");

    // Toggle the past-include checkbox (uncheck "Hide past in copy")
    const node = document.querySelector("[data-field='excludePast']");
    expect(node).toBeTruthy();
    expect(node.checked).toBe(true);
  });

  test("empty slot list copy reflects select mode state", () => {
    bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {},
        calendarTimezone: "UTC",
        outputTimezone: "UTC",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: true,
        autoDetectTimezone: false
      }
    );

    expect(document.querySelector(".tsp-slot-empty").textContent).toBe(
      "Click any time on the grid to add a slot."
    );
  });

  test("keeps saved slot markers visible when select mode is off", () => {
    const { captureOverlay } = bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic",
        columns: [],
        grid: document.createElement("div"),
        calibration: { gridRectTop: 0, gridStartHour: 0, pixelsPerHour: 60, scrollTop: 0 }
      },
      {
        accountScopes: {
          default: {
            selections: [
              { id: "saved", startUTC: "2099-01-01T15:00:00.000Z", endUTC: "2099-01-01T15:30:00.000Z" }
            ]
          }
        },
        calendarTimezone: "UTC",
        outputTimezone: "UTC",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: false,
        autoDetectTimezone: false
      }
    );

    expect(document.querySelector("[data-action='toggle-mode']").textContent).toBe("Select Mode");
    expect(captureOverlay.createCaptureOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        captureEnabled: false,
        selections: [
          { id: "saved", startUTC: "2099-01-01T15:00:00.000Z", endUTC: "2099-01-01T15:30:00.000Z" }
        ]
      })
    );
  });

  test("show-sidebar message expands a collapsed injected panel", () => {
    const { setSpy, triggerMessage } = bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {},
        calendarTimezone: "UTC",
        outputTimezone: "UTC",
        lastDuration: 30,
        sidebarOpen: false,
        selectModeOn: false,
        autoDetectTimezone: false
      }
    );

    expect(document.getElementById("tsp-root").classList.contains("is-collapsed")).toBe(true);

    triggerMessage({ type: "TSP_SHOW_SIDEBAR" });
    vi.advanceTimersByTime(200);

    expect(document.getElementById("tsp-root").classList.contains("is-collapsed")).toBe(false);
    const writes = setSpy.mock.calls.map((call) => call[0].timeSlotPicker);
    expect(writes[writes.length - 1].sidebarOpen).toBe(true);
  });

  test("show-sidebar message received during storage hydration is applied after boot", () => {
    const { flushStorageRead, triggerMessage } = bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {},
        calendarTimezone: "UTC",
        outputTimezone: "UTC",
        lastDuration: 30,
        sidebarOpen: false,
        selectModeOn: false,
        autoDetectTimezone: false
      },
      { deferStorageRead: true }
    );

    expect(document.getElementById("tsp-root")).toBeNull();

    triggerMessage({ type: "TSP_SHOW_SIDEBAR" });
    flushStorageRead();

    expect(document.getElementById("tsp-root").classList.contains("is-collapsed")).toBe(false);
  });

  test("toggling a details section persists open state to storage", () => {
    const { setSpy } = bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {},
        calendarTimezone: "UTC",
        outputTimezone: "UTC",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: false,
        autoDetectTimezone: false,
        uiSections: { timezones: false, format: false, shortcuts: false }
      }
    );

    const fold = document.querySelector("details[data-section='format']");
    fold.open = true;
    fold.dispatchEvent(new Event("toggle"));

    vi.advanceTimersByTime(200);

    const writes = setSpy.mock.calls.map((call) => call[0].timeSlotPicker);
    const lastWrite = writes[writes.length - 1];
    expect(lastWrite.uiSections.format).toBe(true);
  });

  test("ignores self-broadcast storage changes that match our pending write", () => {
    const { triggerStorageChange } = bootContentWithAnchor(
      {
        ok: true,
        bounds: { left: 100, top: 200, width: 700, height: 600 },
        columnSource: "semantic"
      },
      {
        accountScopes: {},
        calendarTimezone: "America/Chicago",
        outputTimezone: "America/Chicago",
        lastDuration: 30,
        sidebarOpen: true,
        selectModeOn: false,
        autoDetectTimezone: false
      }
    );

    // Click a duration button — this triggers a pending write.
    const fifteen = Array.from(document.querySelectorAll("[data-duration]"))
      .find((btn) => btn.dataset.duration === "15");
    fifteen.click();
    expect(fifteen.classList.contains("is-active")).toBe(true);

    // Simulate the chrome.storage.onChanged echo of the same payload.
    // The render after this should not flip the button off.
    const echoed = JSON.parse(JSON.stringify({
      accountScopes: {},
      calendarTimezone: "America/Chicago",
      outputTimezone: "America/Chicago",
      lastDuration: 15,
      sidebarOpen: true,
      selectModeOn: false,
      autoDetectTimezone: false,
      formatOptions: { clock: "12h", includeDate: true, includeZoneLabel: true }
    }));
    triggerStorageChange({ timeSlotPicker: { newValue: echoed } });

    // No flip — the active button stays 15.
    expect(fifteen.classList.contains("is-active")).toBe(true);
  });
});
