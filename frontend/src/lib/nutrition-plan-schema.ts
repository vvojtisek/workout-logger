import { z } from "zod";

// Mirrors the server-side validation in `app/schemas/nutrition_plans.py`.
export const nutritionPlanPayloadSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150, "Max 150 characters"),
    valid_from: z.string().min(1, "Start date is required"),
    valid_to: z.string().nullable(),
    energy_target_kcal: z.number({ error: "Required" }).gt(0, "Must be positive").max(100_000),
    protein_target_g: z.number({ error: "Required" }).min(0).max(10_000),
    carbohydrate_target_g: z.number({ error: "Required" }).min(0).max(10_000),
    fat_target_g: z.number({ error: "Required" }).min(0).max(10_000),
    fiber_target_g: z.number().min(0).max(10_000).nullable(),
  })
  .refine((plan) => !plan.valid_to || plan.valid_to >= plan.valid_from, {
    message: "End date must be on or after the start date",
    path: ["valid_to"],
  });

export type NutritionPlanPayload = z.infer<typeof nutritionPlanPayloadSchema>;
