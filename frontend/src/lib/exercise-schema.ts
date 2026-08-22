import { z } from "zod";

import { MUSCLE_TAGS } from "@/api/types";

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
  instructions: z.array(
    z.string().trim().min(1, "Step cannot be blank").max(1000, "Max 1000 characters"),
  ),
  equipment: z.string().max(200, "Max 200 characters").nullable(),
  safety_notes: z.string().max(4000, "Max 4000 characters").nullable(),
});

export type ExercisePayload = z.infer<typeof exercisePayloadSchema>;
