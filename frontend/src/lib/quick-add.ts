import type { MealEntry, QuickAddPreset } from "@/api/types";
import { mealTypeAt } from "@/lib/today";

type PresetValues = Pick<
  QuickAddPreset,
  "name" | "quantity" | "unit" | "energy_kcal" | "protein_g" | "carbohydrate_g" | "fat_g" | "fiber_g"
>;

/** A meal entry holding the preset as one ad hoc item, logged now. Ad hoc
 * keeps the drink out of the foods list, and its values are a snapshot, so
 * editing the preset later never rewrites what was logged. */
export function presetMealPayload(preset: PresetValues, now: Date) {
  return {
    consumed_at: now.toISOString(),
    meal_type: mealTypeAt(now),
    notes: null,
    items: [
      {
        food_id: null,
        quantity: preset.quantity,
        unit: preset.unit,
        food_name_snapshot: preset.name,
        energy_kcal: preset.energy_kcal,
        protein_g: preset.protein_g,
        carbohydrate_g: preset.carbohydrate_g,
        fat_g: preset.fat_g,
        fiber_g: preset.fiber_g,
      },
    ],
  };
}

/** True for an entry that is just one quick-add drink, so "eat this again"
 * suggestions are not crowded out by the daily coffee. */
export function isPresetEntry(entry: MealEntry, presets: Pick<QuickAddPreset, "name">[]): boolean {
  if (entry.items.length !== 1) return false;
  const [item] = entry.items;
  return item.food_id === null && presets.some((preset) => preset.name === item.food_name_snapshot);
}

export function presetLabel(preset: Pick<QuickAddPreset, "energy_kcal">): string {
  return `${Math.round(preset.energy_kcal)} kcal`;
}
