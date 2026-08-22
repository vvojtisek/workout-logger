import { z } from "zod";

// Mirrors the server-side validation in `app/schemas/programs.py`.
export const programPayloadSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150, "Max 150 characters"),
    kind: z.string().trim().min(1, "Kind is required").max(100, "Max 100 characters"),
    start_date: z.string().min(1, "Start date is required"),
    end_date: z.string().nullable(),
    status: z.enum(["active", "completed", "archived"]),
    notes: z.string().max(4000, "Max 4000 characters").nullable(),
  })
  .refine((program) => !program.end_date || program.end_date >= program.start_date, {
    message: "End date must be on or after the start date",
    path: ["end_date"],
  });

export type ProgramPayload = z.infer<typeof programPayloadSchema>;
