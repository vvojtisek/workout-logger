import { z } from "zod";

// Mirrors the server-side validation in `app/schemas/sleep_entries.py`.
export const sleepEntryPayloadSchema = z
  .object({
    sleep_start: z.string().min(1, "Sleep start is required"),
    sleep_end: z.string().min(1, "Sleep end is required"),
    timezone: z
      .string()
      .refine((value) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Not a recognized IANA timezone name"),
    estimated_sleep_seconds: z.number().min(0).max(86_400).nullable(),
    awake_seconds: z.number().min(0).max(86_400).nullable(),
    quality_score: z.number().int().min(1).max(5).nullable(),
    resting_heart_rate: z.number().min(20).max(250).nullable(),
    notes: z.string().max(2000).nullable(),
    source: z.string().max(30),
  })
  .refine((entry) => new Date(entry.sleep_end) > new Date(entry.sleep_start), {
    message: "Sleep end must be after sleep start",
    path: ["sleep_end"],
  });

export type SleepEntryPayload = z.infer<typeof sleepEntryPayloadSchema>;
