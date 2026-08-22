import { z } from "zod";

// Mirrors the server-side validation in `app/schemas/plans.py` so a plan can
// be rejected in the browser instead of round-tripping a raw 422.
const exercisePayloadSchema = z
  .object({
    exercise_name: z.string().trim().min(1, "Exercise name is required").max(150, "Max 150 characters"),
    target_sets: z
      .number({ error: "Required" })
      .int("Whole number only")
      .min(1, "At least 1")
      .max(100, "At most 100"),
    target_reps_min: z
      .number({ error: "Required" })
      .int("Whole number only")
      .min(1, "At least 1")
      .max(1000, "At most 1000"),
    target_reps_max: z
      .number({ error: "Required" })
      .int("Whole number only")
      .min(1, "At least 1")
      .max(1000, "At most 1000"),
    target_weight_kg: z.number().min(0, "Must be 0 or more").nullable(),
    rest_time_seconds: z
      .number({ error: "Required" })
      .int("Whole number only")
      .min(0, "At least 0")
      .max(3600, "At most 3600"),
    notes: z.string().max(4000, "Max 4000 characters").nullable(),
    group_key: z.string().min(1).max(100, "Max 100 characters").nullable(),
    group_order: z.number().int().min(0).nullable(),
  })
  .refine((row) => row.target_reps_max >= row.target_reps_min, {
    message: "Max reps must be ≥ min reps",
    path: ["target_reps_max"],
  });

export const planPayloadSchema = z.object({
  name: z.string().trim().min(1, "Plan name is required").max(120, "Max 120 characters"),
  description: z.string().max(4000, "Max 4000 characters").nullable(),
  exercises: z.array(exercisePayloadSchema),
});

export type PlanExercisePayload = z.infer<typeof exercisePayloadSchema>;
export type PlanPayload = z.infer<typeof planPayloadSchema>;
