import { describe, expect, it } from "vitest";

import {
  isIsoCalendarDate,
  localDateTimeInputToIso,
  toLocalDateTimeInput,
} from "./date-time-inputs";

describe("ISO date and local date-time input helpers", () => {
  it("accepts only real YYYY-MM-DD calendar dates", () => {
    expect(isIsoCalendarDate("2026-02-28")).toBe(true);
    expect(isIsoCalendarDate("2026-02-29")).toBe(false);
    expect(isIsoCalendarDate("04/05/2026")).toBe(false);
  });

  it("preserves the local calendar date and uses a 24-hour field value", () => {
    expect(toLocalDateTimeInput(new Date(2026, 4, 4, 0, 0))).toBe("2026-05-04 00:00");
    expect(toLocalDateTimeInput(new Date(2026, 4, 4, 12, 0))).toBe("2026-05-04 12:00");
    expect(toLocalDateTimeInput(new Date(2026, 4, 4, 18, 30))).toBe("2026-05-04 18:30");
  });

  it("parses unambiguously and rejects invalid or localized date-time input", () => {
    expect(localDateTimeInputToIso("2026-05-04 00:00")).toBe(
      new Date(2026, 4, 4, 0, 0).toISOString(),
    );
    expect(localDateTimeInputToIso("2026-05-04 12:00")).toBe(
      new Date(2026, 4, 4, 12, 0).toISOString(),
    );
    expect(localDateTimeInputToIso("2026-05-04 18:30")).toBe(
      new Date(2026, 4, 4, 18, 30).toISOString(),
    );
    expect(localDateTimeInputToIso("2026-02-30 10:00")).toBe("");
    expect(localDateTimeInputToIso("05/04/2026 10:00 AM")).toBe("");
  });
});
