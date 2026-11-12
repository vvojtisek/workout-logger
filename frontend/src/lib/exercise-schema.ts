import { z } from "zod";

import { EQUIPMENT_TAGS, MUSCLE_TAGS, MOVEMENT_PATTERNS } from "@/api/types";
import { equipmentOptionsError } from "@/lib/equipment";
import { EQUIPMENT_LOAD_MODES } from "@/lib/load-rules";

// Mirrors the server-side validation in `app/schemas/exercises.py` so an
// exercise can be rejected in the browser instead of round-tripping a raw 422.
const muscleTagSchema = z.enum(MUSCLE_TAGS);

export const exercisePayloadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150, "Max 150 characters"),
  aliases: z.array(z.string().trim().min(1, "Alias cannot be blank").max(150, "Max 150 characters")),
  media_url: z
    .string()
    .max(2000, "Max 2000 characters")
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" && parsed.host.length > 0;
      } catch {
        return false;
      }
    }, "Must be an https:// URL")
    .nullable(),
  primary_muscles: z.array(muscleTagSchema),
  secondary_muscles: z.array(muscleTagSchema),
  movement_patterns: z
    .array(z.enum(MOVEMENT_PATTERNS))
    .max(4, "Choose at most four movement patterns")
    .refine((patterns) => new Set(patterns).size === patterns.length, "Remove duplicate patterns"),
  instructions: z.array(
    z.string().trim().min(1, "Step cannot be blank").max(1000, "Max 1000 characters"),
  ),
  equipment: z.string().max(200, "Max 200 characters").nullable(),
  // null asks the server to read the tags from `equipment`.
  equipment_any_of: z
    .array(z.array(z.enum(EQUIPMENT_TAGS)))
    .nullable()
    .superRefine((options, ctx) => {
      const message = options ? equipmentOptionsError(options) : null;
      if (message) ctx.addIssue({ code: "custom", message });
    }),
  safety_notes: z.string().max(4000, "Max 4000 characters").nullable(),
  progression_increment_kg: z
    .number()
    .min(0.05, "Minimum increment is 0.05 kg")
    .max(20, "Maximum increment is 20 kg")
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
      "Use no more than two decimal places",
    )
    .nullable(),
  equipment_load_mode: z.enum(EQUIPMENT_LOAD_MODES),
  is_unilateral: z.boolean(),
  movement_pattern: z.enum(MOVEMENT_PATTERNS).nullable(),
});

export type ExercisePayload = z.infer<typeof exercisePayloadSchema>;
