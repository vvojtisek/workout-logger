import { describe, expect, it } from "vitest";

import { programWeekProgress } from "./program-week";

describe("programWeekProgress", () => {
  it("numbers seven-day microcycle weeks and elapsed time", () => {
    expect(programWeekProgress("2026-11-01", "2026-11-28", "2026-11-08")).toEqual({
      state: "active",
      week: 2,
      totalWeeks: 4,
      elapsedPercent: 29,
      daysUntilStart: 0,
    });
  });

  it("reports days until a future block starts", () => {
    expect(programWeekProgress("2026-11-15", "2026-12-12", "2026-11-12")).toEqual({
      state: "upcoming",
      week: 0,
      totalWeeks: 4,
      elapsedPercent: 0,
      daysUntilStart: 3,
    });
  });

  it("keeps the final block week visible after its end date", () => {
    expect(programWeekProgress("2026-11-01", "2026-11-28", "2026-12-01")).toEqual({
      state: "ended",
      week: 4,
      totalWeeks: 4,
      elapsedPercent: 100,
      daysUntilStart: 0,
    });
  });

  it("tracks open-ended programs without inventing a duration", () => {
    expect(programWeekProgress("2026-11-01", null, "2026-11-12")).toEqual({
      state: "active",
      week: 2,
      totalWeeks: null,
      elapsedPercent: null,
      daysUntilStart: 0,
    });
  });
});
