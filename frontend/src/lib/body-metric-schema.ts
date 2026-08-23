import { z } from "zod";

// Mirrors the server-side validation in `app/schemas/body_metrics.py`.
const optionalMeasurement = (max: number) =>
  z.number({ error: "Must be a number" }).gt(0, "Must be positive").max(max).nullable();

export const bodyMetricPayloadSchema = z.object({
  measured_at: z.string().min(1, "Date and time are required"),
  weight_kg: z.number({ error: "Weight is required" }).gt(0, "Must be positive").max(500),
  body_fat_percent: z
    .number({ error: "Must be a number" })
    .min(0)
    .max(100, "Must be between 0 and 100")
    .nullable(),
  neck_cm: optionalMeasurement(200),
  chest_cm: optionalMeasurement(300),
  waist_cm: optionalMeasurement(300),
  hips_cm: optionalMeasurement(300),
  biceps_cm: optionalMeasurement(200),
  forearms_cm: optionalMeasurement(200),
  thighs_cm: optionalMeasurement(200),
  calves_cm: optionalMeasurement(200),
});

export type BodyMetricPayload = z.infer<typeof bodyMetricPayloadSchema>;
