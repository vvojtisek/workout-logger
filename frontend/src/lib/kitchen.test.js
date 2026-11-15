import { describe, expect, it } from "vitest";

import { dayOptions, quantityText, rangeEnd, sortGrocery, timingRank } from "./kitchen";

describe("dayOptions", () => {
  it("names today and tomorrow, then weekday and dd/MM", () => {
    const days = dayOptions(new Date(2026, 10, 15, 9), 4);
    expect(days.map((day) => day.label)).toEqual(["Today", "Tomorrow", "Tue 17/11", "Wed 18/11"]);
    expect(days[0].iso).toBe("2026-11-15");
  });
});

describe("rangeEnd", () => {
  it("counts the start day and crosses months", () => {
    expect(rangeEnd("2026-11-15", 1)).toBe("2026-11-15");
    expect(rangeEnd("2026-11-29", 3)).toBe("2026-12-01");
  });
});

describe("quantityText", () => {
  it("drops decimals on whole amounts", () => {
    expect(quantityText(180, "g")).toBe("180 g");
    expect(quantityText(1.25, "tbsp")).toBe("1.3 tbsp");
  });
});

describe("sortGrocery", () => {
  it("puts unchecked items first, then by name", () => {
    /** @param {string} name @param {boolean} checked */
    const line = (name, checked) => ({ name, unit: "g", quantity: 1, checked, item_ids: [], dates: [] });
    const sorted = sortGrocery([line("Rice", true), line("Turkey", false), line("Kale", false)]);
    expect(sorted.map((item) => item.name)).toEqual(["Kale", "Turkey", "Rice"]);
  });
});

describe("timingRank", () => {
  it("orders the day from morning to bedtime", () => {
    expect(timingRank("morning")).toBeLessThan(timingRank("bedtime"));
  });
});
