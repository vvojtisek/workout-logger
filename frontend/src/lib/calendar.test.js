import { describe, expect, it } from "vitest";

import { CALENDAR_WEEKDAYS, leadingBlankDays } from "./calendar";

describe("CALENDAR_WEEKDAYS", () => {
  it("runs Monday to Sunday", () => {
    expect(CALENDAR_WEEKDAYS).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("leadingBlankDays", () => {
  it("puts a month that starts on Monday in the first column", () => {
    expect(leadingBlankDays(2026, 5)).toBe(0); // 1 June 2026 is a Monday
  });

  it("puts a month that starts on Sunday in the last column", () => {
    expect(leadingBlankDays(2026, 10)).toBe(6); // 1 November 2026 is a Sunday
  });

  it("handles the turn of the year", () => {
    expect(leadingBlankDays(2026, 11)).toBe(1); // 1 December 2026 is a Tuesday
    expect(leadingBlankDays(2027, 0)).toBe(4); // 1 January 2027 is a Friday
  });

  it("does not depend on the device time zone", () => {
    // Midnight UTC on the 1st is still the previous day west of Greenwich.
    expect(leadingBlankDays(2026, 2)).toBe(6); // 1 March 2026 is a Sunday
  });
});
