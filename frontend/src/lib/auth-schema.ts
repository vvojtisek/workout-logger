import { z } from "zod";

// Mirrors app/schemas/auth.py's LoginRequest.
export const loginPayloadSchema = z.object({
  email: z.string().trim().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginPayload = z.infer<typeof loginPayloadSchema>;

// Mirrors app/config.py's PASSWORD_MIN_LENGTH.
export const PASSWORD_MIN_LENGTH = 12;

export const acceptInvitePayloadSchema = z
  .object({
    token: z.string().min(1, "Missing invite token"),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type AcceptInvitePayload = z.infer<typeof acceptInvitePayloadSchema>;
