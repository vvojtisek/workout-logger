import { describe, expect, it } from "vitest";

import { exercisePayloadSchema } from "./exercise-schema";

function payload(overrides = {}) {
  return {
    name: "Cable row",
    aliases: [],
    media_url: null,
    primary_muscles: [],
    secondary_muscles: [],
    instructions: [],
    equipment: "Cable",
    equipment_any_of: null,
    safety_notes: null,
    equipment_load_mode: "standard",
    is_unilateral: false,
    progression_increment_kg: null,
    ...overrides,
  };
}

describe("exercise progression increment validation", () => {
  it("accepts a centigram-precision custom increment", () => {
    expect(exercisePayloadSchema.safeParse(payload({ progression_increment_kg: 0.25 })).success)
      .toBe(true);
  });

  it("accepts the automatic equipment-based rule when left blank", () => {
    expect(exercisePayloadSchema.safeParse(payload()).success).toBe(true);
  });

  it.each([0.01, 20.01, 0.125])("rejects invalid increment %s", (increment) => {
    expect(
      exercisePayloadSchema.safeParse(payload({ progression_increment_kg: increment })).success,
    ).toBe(false);
  });
});
