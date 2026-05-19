import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const storage = require("../extension/storage.js");

describe("storage helpers", () => {
  test("derives a simple account scope from Google Calendar account paths", () => {
    expect(storage.getAccountScope("https://calendar.google.com/calendar/u/0/r/week")).toBe("u/0");
    expect(storage.getAccountScope("https://calendar.google.com/calendar/u/12/r/day")).toBe("u/12");
    expect(storage.getAccountScope("https://calendar.google.com/calendar/r/week")).toBe("default");
  });

  test("keeps selections separate per account scope", () => {
    const state = storage.createDefaultState("America/Chicago");
    const next = storage.setSelectionsForScope(state, "u/0", [
      { id: "work", startUTC: "2026-05-07T13:00:00.000Z", endUTC: "2026-05-07T13:30:00.000Z" }
    ]);
    const afterPersonal = storage.setSelectionsForScope(next, "u/1", [
      { id: "personal", startUTC: "2026-05-08T13:00:00.000Z", endUTC: "2026-05-08T13:30:00.000Z" }
    ]);

    expect(storage.getSelectionsForScope(afterPersonal, "u/0")).toHaveLength(1);
    expect(storage.getSelectionsForScope(afterPersonal, "u/1")).toHaveLength(1);
    expect(storage.getSelectionsForScope(afterPersonal, "default")).toEqual([]);
  });

  test("normalizeState falls back to detected timezone when stored zone is invalid", () => {
    const normalized = storage.normalizeState({
      calendarTimezone: "Mars/Olympus_Mons",
      outputTimezone: "America/Los_Angeles"
    });
    expect(storage.isValidTimezone(normalized.calendarTimezone)).toBe(true);
    expect(normalized.outputTimezone).toBe("America/Los_Angeles");
  });

  test("normalizeState fills missing fields and sanitizes format options", () => {
    const normalized = storage.normalizeState({
      formatOptions: { clock: "bogus", includeDate: false, includeZoneLabel: "yes" }
    });
    expect(normalized.formatOptions.clock).toBe("12h");
    expect(normalized.formatOptions.includeDate).toBe(false);
    expect(normalized.formatOptions.includeZoneLabel).toBe(true);
    expect(normalized.autoDetectTimezone).toBe(true);
    expect(normalized.lastDuration).toBe(30);
  });

  test("sanitizeSelections drops invalid entries and duplicate IDs", () => {
    const cleaned = storage.sanitizeSelections([
      { id: "a", startUTC: "2026-05-07T13:00:00.000Z", endUTC: "2026-05-07T13:30:00.000Z" },
      { id: "a", startUTC: "2026-05-08T13:00:00.000Z", endUTC: "2026-05-08T13:30:00.000Z" },
      { id: "", startUTC: "2026-05-07T13:00:00.000Z", endUTC: "2026-05-07T13:30:00.000Z" },
      { id: "bad", startUTC: "not-a-date", endUTC: "also-bad" },
      null
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].id).toBe("a");
  });

  test("pruneStaleFromState removes only ended slots across all scopes", () => {
    const seeded = storage.setSelectionsForScope(
      storage.setSelectionsForScope(storage.createDefaultState("UTC"), "u/0", [
        { id: "past", startUTC: "2026-05-01T00:00:00.000Z", endUTC: "2026-05-01T01:00:00.000Z" },
        { id: "future", startUTC: "2026-06-01T00:00:00.000Z", endUTC: "2026-06-01T01:00:00.000Z" }
      ]),
      "u/1",
      [
        { id: "current", startUTC: "2026-05-14T10:00:00.000Z", endUTC: "2026-05-14T11:30:00.000Z" }
      ]
    );

    const result = storage.pruneStaleFromState(seeded, Date.parse("2026-05-14T11:00:00.000Z"));
    expect(result.removedCount).toBe(1);
    expect(storage.getSelectionsForScope(result.state, "u/0").map((s) => s.id)).toEqual(["future"]);
    expect(storage.getSelectionsForScope(result.state, "u/1").map((s) => s.id)).toEqual(["current"]);
  });
});
