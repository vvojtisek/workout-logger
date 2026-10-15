import { describe, expect, it } from "vitest";

import { WEEKDAY_LABELS, nextMondayIso, toggleWeekday } from "./program-templates";

describe("nextMondayIso", () => {
  it("keeps a Monday and moves other days forward", () => {
    expect(nextMondayIso(new Date(2026, 9, 19))).toBe("2026-10-19");
    expect(nextMondayIso(new Date(2026, 9, 15))).toBe("2026-10-19");
    expect(nextMondayIso(new Date(2026, 9, 25))).toBe("2026-10-26");
  });
});

describe("toggleWeekday", () => {
  it("adds in order, removes, and refuses to exceed the limit", () => {
    expect(toggleWeekday([2], 0, 2)).toEqual([0, 2]);
    expect(toggleWeekday([0, 2], 2, 2)).toEqual([0]);
    expect(toggleWeekday([0, 2], 4, 2)).toEqual([0, 2]);
  });

  it("labels Monday first", () => {
    expect(WEEKDAY_LABELS[0]).toBe("Mon");
    expect(WEEKDAY_LABELS).toHaveLength(7);
  });
});
