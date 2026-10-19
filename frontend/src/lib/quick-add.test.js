import { describe, expect, it } from "vitest";

import { isPresetEntry, presetLabel, presetMealPayload } from "./quick-add";

const cappuccino = {
  name: "Cappuccino",
  quantity: 150,
  unit: "ml",
  energy_kcal: 90,
  protein_g: 5,
  carbohydrate_g: 7.2,
  fat_g: 4.5,
  fiber_g: null,
};

/** @param {import("@/api/types").MealItem[]} items @returns {import("@/api/types").MealEntry} */
function entry(items) {
  const at = "2026-10-19T07:00:00Z";
  return { id: "e1", consumed_at: at, meal_type: "breakfast", notes: null, items, created_at: at, updated_at: at };
}

/** @param {Partial<import("@/api/types").MealItem>} overrides @returns {import("@/api/types").MealItem} */
function item(overrides) {
  return {
    id: "i1",
    food_id: null,
    food_name_snapshot: "Cappuccino",
    quantity: 150,
    unit: "ml",
    energy_kcal_snapshot: 90,
    protein_g_snapshot: 5,
    carbohydrate_g_snapshot: 7.2,
    fat_g_snapshot: 4.5,
    fiber_g_snapshot: null,
    ...overrides,
  };
}

describe("presetMealPayload", () => {
  it("logs the preset as one ad hoc item with its own values, now", () => {
    const now = new Date(2026, 9, 19, 8, 15);
    expect(presetMealPayload(cappuccino, now)).toEqual({
      consumed_at: now.toISOString(),
      meal_type: "breakfast",
      notes: null,
      items: [
        {
          food_id: null,
          quantity: 150,
          unit: "ml",
          food_name_snapshot: "Cappuccino",
          energy_kcal: 90,
          protein_g: 5,
          carbohydrate_g: 7.2,
          fat_g: 4.5,
          fiber_g: null,
        },
      ],
    });
  });

  it("files an afternoon drink as a snack", () => {
    expect(presetMealPayload(cappuccino, new Date(2026, 9, 19, 15, 30)).meal_type).toBe("snack");
  });
});

describe("isPresetEntry", () => {
  const presets = [{ name: "Cappuccino" }, { name: "Tea" }];

  it("matches an entry holding only a quick-add drink", () => {
    expect(isPresetEntry(entry([item({})]), presets)).toBe(true);
  });

  it("keeps meals that only include a drink, food-backed items and unknown names", () => {
    expect(isPresetEntry(entry([item({}), item({ id: "i2", food_name_snapshot: "Rohlík" })]), presets)).toBe(false);
    expect(isPresetEntry(entry([item({ food_id: "f1" })]), presets)).toBe(false);
    expect(isPresetEntry(entry([item({ food_name_snapshot: "Latte" })]), presets)).toBe(false);
  });
});

describe("presetLabel", () => {
  it("shows rounded energy so a chip fits on a phone row", () => {
    expect(presetLabel({ energy_kcal: 0.4 })).toBe("0 kcal");
    expect(presetLabel({ energy_kcal: 89.6 })).toBe("90 kcal");
  });
});
