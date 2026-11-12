import { describe, expect, it } from "vitest";

import { planPayloadSchema } from "./plan-schema";

/** @param {number | null} target_rir @param {"strength" | "bodyweight"} [exercise_kind] */
const payload = (target_rir, exercise_kind = "strength") => ({
  name: "Strength day",
  description: null,
  exercises: [
    {
      exercise_name: "Bench press",
      exercise_kind,
      target_sets: 3,
      target_reps_min: 5,
      target_reps_max: 8,
      target_weight_kg: 60,
      target_rir,
      rest_time_seconds: 90,
      notes: null,
      group_key: null,
      group_order: null,
    },
  ],
});

describe("plan target RIR", () => {
  it("keeps an explicit RIR target in the validated payload", () => {
    const result = planPayloadSchema.safeParse(payload(2));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.exercises[0].target_rir).toBe(2);
  });

  it("allows an unspecified target and rejects values above ten", () => {
    expect(planPayloadSchema.safeParse(payload(null)).success).toBe(true);
    expect(planPayloadSchema.safeParse(payload(11)).success).toBe(false);
    expect(planPayloadSchema.safeParse(payload(2, "bodyweight")).success).toBe(false);
  });
});
