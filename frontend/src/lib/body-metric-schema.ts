import { z } from "zod";

// Mirrors the server-side validation in `app/schemas/body_metrics.py`.
export const measurementMax = {
  weight_kg: 500,
  body_fat_percent: 100,
  neck_cm: 200,
  chest_cm: 300,
  waist_cm: 300,
  hips_cm: 300,
  biceps_cm: 200,
  forearms_cm: 200,
  thighs_cm: 200,
  calves_cm: 200,
} as const;

const optionalMeasurement = (max: number) =>
  z.number({ error: "Must be a number" }).gt(0, "Must be positive").max(max).nullable();

export const bodyMetricPayloadSchema = z.object({
  measured_at: z.string().min(1, "Date and time are required"),
  weight_kg: z
    .number({ error: "Weight is required" })
    .gt(0, "Must be positive")
    .max(measurementMax.weight_kg),
  body_fat_percent: z
    .number({ error: "Must be a number" })
    .min(0)
    .max(measurementMax.body_fat_percent, "Must be between 0 and 100")
    .nullable(),
  neck_cm: optionalMeasurement(measurementMax.neck_cm),
  chest_cm: optionalMeasurement(measurementMax.chest_cm),
  waist_cm: optionalMeasurement(measurementMax.waist_cm),
  hips_cm: optionalMeasurement(measurementMax.hips_cm),
  biceps_cm: optionalMeasurement(measurementMax.biceps_cm),
  forearms_cm: optionalMeasurement(measurementMax.forearms_cm),
  thighs_cm: optionalMeasurement(measurementMax.thighs_cm),
  calves_cm: optionalMeasurement(measurementMax.calves_cm),
});

export type BodyMetricPayload = z.infer<typeof bodyMetricPayloadSchema>;
