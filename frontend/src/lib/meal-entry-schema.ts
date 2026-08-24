import { z } from "zod";

// Mirrors the server-side validation in `app/schemas/meal_entries.py`.
export const mealItemPayloadSchema = z
  .object({
    food_id: z.string().nullable(),
    quantity: z.number({ error: "Required" }).gt(0, "Must be positive").max(100_000),
    unit: z.string().max(30).nullable(),
    food_name_snapshot: z.string().max(200).nullable(),
    energy_kcal: z.number().min(0).max(100_000).nullable(),
    protein_g: z.number().min(0).max(10_000).nullable(),
    carbohydrate_g: z.number().min(0).max(10_000).nullable(),
    fat_g: z.number().min(0).max(10_000).nullable(),
    fiber_g: z.number().min(0).max(10_000).nullable(),
  })
  .refine(
    (item) =>
      item.food_id !== null ||
      (item.food_name_snapshot &&
        item.unit &&
        item.energy_kcal !== null &&
        item.protein_g !== null &&
        item.carbohydrate_g !== null &&
        item.fat_g !== null),
    { message: "Pick a food, or fill in name/unit/energy/protein/carbs/fat directly" },
  );

export const mealEntryPayloadSchema = z.object({
  consumed_at: z.string().min(1, "Date and time are required"),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  notes: z.string().max(2000).nullable(),
  items: z.array(mealItemPayloadSchema).min(1, "Add at least one item"),
});

export type MealEntryPayload = z.infer<typeof mealEntryPayloadSchema>;
