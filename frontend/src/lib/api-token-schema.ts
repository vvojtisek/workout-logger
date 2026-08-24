import { z } from "zod";

import { API_TOKEN_SCOPES } from "@/api/types";

// Mirrors the server-side validation in `app/schemas/api_tokens.py`.
export const apiTokenPayloadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1, "Select at least one scope"),
});

export type ApiTokenPayload = z.infer<typeof apiTokenPayloadSchema>;
