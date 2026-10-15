import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, formatTime } from "./format";

/**
 * A timestamp for a local wall-clock time, whatever the test machine's zone.
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} hours
 * @param {number} minutes
 */
function local(year, month, day, hours, minutes) {
  return new Date(year, month - 1, day, hours, minutes).toISOString();
}

describe("formatDate", () => {
  it("writes calendar dates day first", () => {
    expect(formatDate("2026-05-04")).toBe("04/05/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
  });

  it("never shifts a calendar date through a time zone", () => {
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
  });

  it("uses the local date of a timestamp", () => {
    expect(formatDate(local(2026, 5, 4, 23, 50))).toBe("04/05/2026");
  });

  it("leaves missing or unreadable values alone", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("soon")).toBe("soon");
  });
});

describe("formatTime", () => {
  it("uses a 24-hour clock with no AM/PM", () => {
    expect(formatTime(local(2026, 5, 4, 7, 5))).toBe("07:05");
    expect(formatTime(local(2026, 5, 4, 18, 30))).toBe("18:30");
    expect(formatTime(local(2026, 5, 4, 0, 0))).toBe("00:00");
  });
});

describe("formatDateTime", () => {
  it("joins the day-first date and the 24-hour time", () => {
    expect(formatDateTime(local(2026, 5, 4, 18, 30))).toBe("04/05/2026 18:30");
    expect(formatDateTime(local(2026, 4, 5, 6, 45))).toBe("05/04/2026 06:45");
  });

  it("leaves missing values empty", () => {
    expect(formatDateTime(undefined)).toBe("");
  });
});
