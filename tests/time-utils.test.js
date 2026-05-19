import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const utils = require("../extension/time-utils.js");

describe("time-utils", () => {
  test("snaps times to the nearest increment", () => {
    expect(utils.snapToIncrement({ hour: 9, minute: 7 }, 15)).toEqual({
      hour: 9,
      minute: 0,
      totalMinutes: 540
    });

    expect(utils.snapToIncrement({ hour: 9, minute: 8 }, 15)).toEqual({
      hour: 9,
      minute: 15,
      totalMinutes: 555
    });

    expect(utils.snapToIncrement({ hour: 23, minute: 55 }, 15)).toEqual({
      hour: 23,
      minute: 45,
      totalMinutes: 1425
    });
  });

  test("maps viewport Y coordinates to wall-clock time while accounting for grid scroll", () => {
    const calibration = {
      gridRectTop: 100,
      scrollTop: 300,
      pixelsPerHour: 60,
      gridStartHour: 0
    };

    expect(utils.clientPointToTime(340, calibration)).toEqual({
      hour: 9,
      minute: 0,
      totalMinutes: 540
    });
  });

  test("maps viewport X coordinates to the matching visible day column", () => {
    const columns = [
      { left: 100, right: 200, date: { year: 2026, month: 5, day: 4 } },
      { left: 200, right: 300, date: { year: 2026, month: 5, day: 5 } },
      { left: 300, right: 400, date: { year: 2026, month: 5, day: 6 } }
    ];

    expect(utils.clientPointToDate(240, columns)).toEqual({
      year: 2026,
      month: 5,
      day: 5
    });
    expect(utils.clientPointToDate(99, columns)).toBeNull();
  });

  test("builds UTC slots from calendar wall time and clamps midnight crossings", () => {
    const slot = utils.buildSlot({
      date: { year: 2026, month: 5, day: 7 },
      time: { hour: 9, minute: 0 },
      durationMinutes: 30,
      timeZone: "America/New_York"
    });

    expect(slot.startUTC).toBe("2026-05-07T13:00:00.000Z");
    expect(slot.endUTC).toBe("2026-05-07T13:30:00.000Z");
    expect(slot.clamped).toBe(false);

    const clamped = utils.buildSlot({
      date: { year: 2026, month: 5, day: 7 },
      time: { hour: 23, minute: 45 },
      durationMinutes: 60,
      timeZone: "America/New_York"
    });

    expect(clamped.startUTC).toBe("2026-05-08T03:45:00.000Z");
    expect(clamped.endUTC).toBe("2026-05-08T04:00:00.000Z");
    expect(clamped.clamped).toBe(true);
  });

  test("handles DST fall-back ambiguity and spring-forward gaps consistently", () => {
    expect(
      utils.zonedWallTimeToUtc(
        { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
        "America/New_York"
      ).toISOString()
    ).toBe("2026-11-01T06:30:00.000Z");

    expect(
      utils.zonedWallTimeToUtc(
        { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
        "America/New_York"
      ).toISOString()
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  test("formats grouped output in the selected output timezone", () => {
    const text = utils.formatOutput(
      [
        {
          id: "a",
          startUTC: "2026-05-07T18:00:00.000Z",
          endUTC: "2026-05-07T19:00:00.000Z"
        },
        {
          id: "b",
          startUTC: "2026-05-07T13:00:00.000Z",
          endUTC: "2026-05-07T13:30:00.000Z"
        }
      ],
      "America/New_York",
      { excludePast: false }
    );

    expect(text).toBe(
      "Thu, May 7\n  9:00 AM - 9:30 AM ET\n  2:00 PM - 3:00 PM ET"
    );
  });

  test("toggles an existing slot when the raw click lands anywhere inside it", () => {
    const existing = [
      {
        id: "a",
        startUTC: "2026-05-07T13:00:00.000Z",
        endUTC: "2026-05-07T14:00:00.000Z"
      }
    ];
    const clicked = {
      id: "b",
      startUTC: "2026-05-07T14:00:00.000Z",
      endUTC: "2026-05-07T14:30:00.000Z",
      selectionPointUTC: "2026-05-07T13:55:00.000Z"
    };

    expect(utils.applySlotSelection(existing, clicked)).toEqual({
      selections: [],
      action: "removed",
      conflict: null
    });
  });

  test("does not persist transient click metadata when adding a slot", () => {
    const added = {
      id: "b",
      startUTC: "2026-05-07T14:00:00.000Z",
      endUTC: "2026-05-07T14:30:00.000Z",
      selectionPointUTC: "2026-05-07T13:55:00.000Z"
    };

    expect(utils.applySlotSelection([], added)).toEqual({
      selections: [
        {
          id: "b",
          startUTC: "2026-05-07T14:00:00.000Z",
          endUTC: "2026-05-07T14:30:00.000Z",
          clamped: false
        }
      ],
      action: "added",
      conflict: null
    });
  });

  test("persists clamped metadata on added slots", () => {
    const clamped = {
      id: "late",
      startUTC: "2026-05-08T03:45:00.000Z",
      endUTC: "2026-05-08T04:00:00.000Z",
      clamped: true
    };

    expect(utils.applySlotSelection([], clamped).selections[0].clamped).toBe(true);
  });

  test("formats output with 24h clock and without date headers when configured", () => {
    const selections = [
      {
        id: "a",
        startUTC: "2026-05-07T18:00:00.000Z",
        endUTC: "2026-05-07T19:00:00.000Z"
      }
    ];

    expect(
      utils.formatOutput(selections, "America/New_York", { clock: "24h", excludePast: false })
    ).toBe("Thu, May 7\n  14:00 - 15:00 ET");

    expect(
      utils.formatOutput(selections, "America/New_York", { includeDate: false, excludePast: false })
    ).toBe("2:00 PM - 3:00 PM ET");

    expect(
      utils.formatOutput(selections, "America/New_York", { includeZoneLabel: false, excludePast: false })
    ).toBe("Thu, May 7\n  2:00 PM - 3:00 PM");
  });

  test("excludePast filters slots whose end is in the past when copying", () => {
    const selections = [
      {
        id: "old",
        startUTC: "2020-01-01T00:00:00.000Z",
        endUTC: "2020-01-01T01:00:00.000Z"
      },
      {
        id: "fresh",
        startUTC: "2099-01-01T00:00:00.000Z",
        endUTC: "2099-01-01T01:00:00.000Z"
      }
    ];
    const cutoff = Date.parse("2050-01-01T00:00:00.000Z");

    expect(utils.formatOutput(selections, "UTC", {}, cutoff)).toBe(
      "Thu, Jan 1\n  12:00 AM - 1:00 AM UTC"
    );

    // With excludePast false, both appear.
    expect(utils.formatOutput(selections, "UTC", { excludePast: false }, cutoff)).toContain(
      "Wed, Jan 1"
    );
  });

  test("normalizes garbage format option values to safe defaults", () => {
    const normalized = utils.normalizeFormatOptions({
      clock: "weird",
      includeDate: "no",
      includeZoneLabel: undefined,
      separator: ""
    });
    expect(normalized.clock).toBe("12h");
    expect(normalized.includeDate).toBe(true);
    expect(normalized.includeZoneLabel).toBe(true);
    expect(normalized.separator).toBe(" - ");

    const explicit = utils.normalizeFormatOptions({ includeDate: false, includeZoneLabel: false });
    expect(explicit.includeDate).toBe(false);
    expect(explicit.includeZoneLabel).toBe(false);
  });

  test("prunes selections whose end has already passed", () => {
    const selections = [
      { id: "past", startUTC: "2026-05-01T00:00:00.000Z", endUTC: "2026-05-01T01:00:00.000Z" },
      { id: "now", startUTC: "2026-05-14T11:00:00.000Z", endUTC: "2026-05-14T12:00:00.000Z" },
      { id: "future", startUTC: "2026-06-01T00:00:00.000Z", endUTC: "2026-06-01T01:00:00.000Z" }
    ];
    const cutoff = Date.parse("2026-05-14T10:00:00.000Z");
    const { kept, removed } = utils.pruneStaleSelections(selections, cutoff);
    expect(removed.map((s) => s.id)).toEqual(["past"]);
    expect(kept.map((s) => s.id)).toEqual(["now", "future"]);
  });

  test("treats invalid cutoff input as a no-op rather than dropping everything", () => {
    const selections = [{ id: "a", startUTC: "2026-05-01T00:00:00.000Z", endUTC: "2026-05-01T01:00:00.000Z" }];
    expect(utils.pruneStaleSelections(selections, "not-a-date").kept).toEqual(selections);
    expect(utils.pruneStaleSelections([], Date.now()).kept).toEqual([]);
  });

  test("identifies valid and invalid IANA timezones", () => {
    expect(utils.isValidTimezone("America/Los_Angeles")).toBe(true);
    expect(utils.isValidTimezone("UTC")).toBe(true);
    expect(utils.isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(utils.isValidTimezone("")).toBe(false);
    expect(utils.isValidTimezone(null)).toBe(false);
  });

  test("buildZoneOptionGroups surfaces detected and US zones first", () => {
    const groups = utils.buildZoneOptionGroups("America/Los_Angeles");
    expect(groups[0].label).toBe("Detected");
    expect(groups[0].zones).toEqual(["America/Los_Angeles"]);
    expect(groups[1].label).toBe("United States");
    expect(groups[1].zones).toContain("America/New_York");
    expect(groups[1].zones).not.toContain("America/Los_Angeles");
    const allLabels = groups.map((g) => g.label);
    expect(allLabels).toContain("International");
  });

  test("buildZoneOptionGroups omits invalid detected zone", () => {
    const groups = utils.buildZoneOptionGroups("Not/A_Zone");
    expect(groups[0].label).not.toBe("Detected");
  });

  test("rejects overlapping slots that do not represent a toggle", () => {
    const existing = [
      {
        id: "a",
        startUTC: "2026-05-07T13:00:00.000Z",
        endUTC: "2026-05-07T13:30:00.000Z"
      }
    ];
    const clicked = {
      id: "b",
      startUTC: "2026-05-07T13:30:00.000Z",
      endUTC: "2026-05-07T14:00:00.000Z"
    };
    const overlapping = {
      id: "c",
      startUTC: "2026-05-07T12:45:00.000Z",
      endUTC: "2026-05-07T13:15:00.000Z"
    };

    expect(utils.applySlotSelection(existing, clicked).action).toBe("added");
    expect(utils.applySlotSelection(existing, overlapping)).toEqual({
      selections: existing,
      action: "conflict",
      conflict: existing[0]
    });
  });
});
