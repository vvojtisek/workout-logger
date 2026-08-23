import { z } from "zod";

// Mirrors the server-side validation in `app/schemas/foods.py`.
export const foodPayloadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Max 200 characters"),
  brand: z.string().max(150, "Max 150 characters").nullable(),
  serving_quantity: z.number({ error: "Required" }).gt(0, "Must be positive").max(100_000),
  serving_unit: z.string().trim().min(1, "Unit is required").max(30, "Max 30 characters"),
  energy_kcal: z.number({ error: "Required" }).min(0).max(100_000),
  protein_g: z.number({ error: "Required" }).min(0).max(10_000),
  carbohydrate_g: z.number({ error: "Required" }).min(0).max(10_000),
  fat_g: z.number({ error: "Required" }).min(0).max(10_000),
  fiber_g: z.number().min(0).max(10_000).nullable(),
  source: z.string().max(30),
});

export type FoodPayload = z.infer<typeof foodPayloadSchema>;
