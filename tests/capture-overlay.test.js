import { createRequire } from "node:module";
import { afterEach, describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const capture = require("../extension/capture-overlay.js");
const utils = require("../extension/time-utils.js");

function rect(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("capture-overlay", () => {
  test("positions the click layer over selectable bounds instead of the whole grid", () => {
    global.TimeSlotPickerUtils = {};
    const grid = document.createElement("div");
    grid.getBoundingClientRect = () => rect(50, 100, 900, 700);

    capture.createCaptureOverlay({
      anchor: {
        grid,
        bounds: rect(200, 240, 600, 560),
        calibration: { gridRectTop: 100, gridStartHour: 6, pixelsPerHour: 60, scrollTop: 0 },
        columns: []
      },
      durationMinutes: 30,
      calendarTimezone: "America/Chicago",
      selections: [],
      onSlot: () => {},
      onError: () => {}
    });

    const overlay = document.querySelector(".tsp-capture-overlay");

    expect(overlay.style.left).toBe("200px");
    expect(overlay.style.top).toBe("240px");
    expect(overlay.style.width).toBe("600px");
    expect(overlay.style.height).toBe("560px");
  });

  test("renders selected-slot markers relative to selectable bounds", () => {
    global.TimeSlotPickerUtils = {};
    const grid = document.createElement("div");
    grid.getBoundingClientRect = () => rect(50, 100, 900, 700);

    capture.createCaptureOverlay({
      anchor: {
        grid,
        bounds: rect(200, 240, 600, 560),
        calibration: { gridRectTop: 100, gridStartHour: 6, pixelsPerHour: 60, scrollTop: 0 },
        columns: [
          { left: 200, right: 300, date: { year: 2026, month: 5, day: 13 } }
        ]
      },
      durationMinutes: 30,
      calendarTimezone: "America/Chicago",
      selections: [
        {
          id: "slot-1",
          startUTC: "2026-05-13T14:00:00.000Z",
          endUTC: "2026-05-13T14:30:00.000Z"
        }
      ],
      onSlot: () => {},
      onError: () => {}
    });

    const marker = document.querySelector(".tsp-marker");

    expect(marker.style.left).toBe("0px");
    expect(marker.style.top).toBe("40px");
    expect(marker.style.width).toBe("100px");
    expect(marker.style.height).toBe("30px");
  });

  test("renders surgical capture strips for selectable day columns only", () => {
    global.TimeSlotPickerUtils = {};
    const grid = document.createElement("div");
    grid.getBoundingClientRect = () => rect(50, 100, 900, 700);

    capture.createCaptureOverlay({
      anchor: {
        grid,
        bounds: rect(200, 240, 600, 560),
        calibration: { gridRectTop: 100, gridStartHour: 6, pixelsPerHour: 60, scrollTop: 0 },
        columns: [
          { left: 200, right: 300, date: { year: 2026, month: 5, day: 13 } },
          { left: 330, right: 430, date: { year: 2026, month: 5, day: 14 } },
          { left: 900, right: 1000, date: { year: 2026, month: 5, day: 15 } }
        ]
      },
      durationMinutes: 30,
      calendarTimezone: "America/Chicago",
      selections: [],
      onSlot: () => {},
      onError: () => {}
    });

    const strips = Array.from(document.querySelectorAll(".tsp-capture-column"));

    expect(strips).toHaveLength(2);
    expect(strips[0].style.left).toBe("0px");
    expect(strips[0].style.width).toBe("100px");
    expect(strips[1].style.left).toBe("130px");
    expect(strips[1].style.width).toBe("100px");
  });

  test("does not let the overlay wrapper handle calendar clicks outside capture strips", () => {
    const onSlot = vi.fn();
    const onError = vi.fn();
    global.TimeSlotPickerUtils = {
      clientPointToTime: () => ({ hour: 9, minute: 0 }),
      clientPointToDate: () => ({ year: 2026, month: 5, day: 13 }),
      snapToIncrement: (time) => ({ ...time, totalMinutes: 540 }),
      toTotalMinutes: (time) => time.totalMinutes,
      wallTimeToUtcIso: () => "2026-05-13T14:00:00.000Z",
      buildSlot: () => ({ id: "slot-1", startUTC: "2026-05-13T14:00:00.000Z", endUTC: "2026-05-13T14:30:00.000Z" })
    };
    const grid = document.createElement("div");
    grid.getBoundingClientRect = () => rect(50, 100, 900, 700);

    capture.createCaptureOverlay({
      anchor: {
        grid,
        bounds: rect(200, 240, 600, 560),
        calibration: { gridRectTop: 100, gridStartHour: 6, pixelsPerHour: 60, scrollTop: 0 },
        columns: [
          { left: 200, right: 300, date: { year: 2026, month: 5, day: 13 } }
        ]
      },
      durationMinutes: 30,
      calendarTimezone: "America/Chicago",
      selections: [],
      onSlot,
      onError
    });

    document.querySelector(".tsp-capture-overlay").dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 250, clientY: 300 })
    );

    expect(onSlot).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test("keeps slot creation on selectable capture strips", () => {
    const onSlot = vi.fn();
    global.TimeSlotPickerUtils = {
      clientPointToTime: () => ({ hour: 9, minute: 0 }),
      clientPointToDate: () => ({ year: 2026, month: 5, day: 13 }),
      snapToIncrement: (time) => ({ ...time, totalMinutes: 540 }),
      toTotalMinutes: (time) => time.totalMinutes,
      wallTimeToUtcIso: () => "2026-05-13T14:00:00.000Z",
      buildSlot: () => ({ id: "slot-1", startUTC: "2026-05-13T14:00:00.000Z", endUTC: "2026-05-13T14:30:00.000Z" })
    };
    const grid = document.createElement("div");
    grid.getBoundingClientRect = () => rect(50, 100, 900, 700);

    capture.createCaptureOverlay({
      anchor: {
        grid,
        bounds: rect(200, 240, 600, 560),
        calibration: { gridRectTop: 100, gridStartHour: 6, pixelsPerHour: 60, scrollTop: 0 },
        columns: [
          { left: 200, right: 300, date: { year: 2026, month: 5, day: 13 } }
        ]
      },
      durationMinutes: 30,
      calendarTimezone: "America/Chicago",
      selections: [],
      onSlot,
      onError: () => {}
    });

    document.querySelector(".tsp-capture-column").dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 250, clientY: 300 })
    );

    expect(onSlot).toHaveBeenCalledWith({
      id: "slot-1",
      startUTC: "2026-05-13T14:00:00.000Z",
      endUTC: "2026-05-13T14:30:00.000Z",
      selectionPointUTC: "2026-05-13T14:00:00.000Z"
    });
  });

  test("centers the hover preview on the pointer for 30-minute slots", () => {
    global.TimeSlotPickerUtils = utils;
    const grid = document.createElement("div");
    grid.getBoundingClientRect = () => rect(50, 100, 900, 700);

    capture.createCaptureOverlay({
      anchor: {
        grid,
        bounds: rect(200, 240, 600, 560),
        calibration: { gridRectTop: 100, gridStartHour: 6, pixelsPerHour: 60, scrollTop: 0 },
        columns: [
          { left: 200, right: 300, date: { year: 2026, month: 5, day: 13 } }
        ]
      },
      durationMinutes: 30,
      calendarTimezone: "UTC",
      selections: [],
      onSlot: () => {},
      onError: () => {}
    });

    const pointerY = 310; // 9:30 AM in the calibrated grid.
    document.querySelector(".tsp-capture-column").dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 250, clientY: pointerY })
    );

    const preview = document.querySelector(".tsp-preview");
    const previewTop = Number.parseFloat(preview.style.top);
    const previewHeight = Number.parseFloat(preview.style.height);
    const pointerYWithinOverlay = pointerY - 240;

    expect(preview.style.display).toBe("block");
    expect(previewTop + previewHeight / 2).toBe(pointerYWithinOverlay);
  });

  test("creates a snapped slot around the pointer instead of starting at the pointer", () => {
    const onSlot = vi.fn();
    global.TimeSlotPickerUtils = utils;
    const grid = document.createElement("div");
    grid.getBoundingClientRect = () => rect(50, 100, 900, 700);

    capture.createCaptureOverlay({
      anchor: {
        grid,
        bounds: rect(200, 240, 600, 560),
        calibration: { gridRectTop: 100, gridStartHour: 6, pixelsPerHour: 60, scrollTop: 0 },
        columns: [
          { left: 200, right: 300, date: { year: 2026, month: 5, day: 13 } }
        ]
      },
      durationMinutes: 30,
      calendarTimezone: "UTC",
      selections: [],
      onSlot,
      onError: () => {}
    });

    document.querySelector(".tsp-capture-column").dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 250, clientY: 310 })
    );

    expect(onSlot).toHaveBeenCalledWith(expect.objectContaining({
      startUTC: "2026-05-13T09:15:00.000Z",
      endUTC: "2026-05-13T09:45:00.000Z",
      selectionPointUTC: "2026-05-13T09:30:00.000Z"
    }));
  });

  test("keeps snap-guide calibration off the global overlay surface", () => {
    global.TimeSlotPickerUtils = {};
    const grid = document.createElement("div");
    grid.getBoundingClientRect = () => rect(50, 100, 900, 700);

    capture.createCaptureOverlay({
      anchor: {
        grid,
        bounds: rect(200, 240, 600, 560),
        calibration: { gridRectTop: 100, gridStartHour: 6, pixelsPerHour: 60, scrollTop: 0 },
        columns: [
          { left: 200, right: 300, date: { year: 2026, month: 5, day: 13 } }
        ]
      },
      durationMinutes: 30,
      calendarTimezone: "UTC",
      selections: [],
      onSlot: () => {},
      onError: () => {}
    });

    const overlay = document.querySelector(".tsp-capture-overlay");

    expect(overlay.style.getPropertyValue("--tsp-quarter-px")).toBe("");
    expect(overlay.style.getPropertyValue("--tsp-quarter-offset-y")).toBe("");
  });
});
