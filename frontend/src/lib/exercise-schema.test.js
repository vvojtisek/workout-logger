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
    movement_pattern: null,
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

describe("movement-pattern classification", () => {
  it("keeps a controlled movement pattern in the validated payload", () => {
    expect(exercisePayloadSchema.parse(payload({ movement_pattern: "horizontal_push" })).movement_pattern)
      .toBe("horizontal_push");
  });

  it("allows an exercise to remain unclassified", () => {
    expect(exercisePayloadSchema.parse(payload()).movement_pattern).toBeNull();
  });

  it("rejects free-text values outside the movement taxonomy", () => {
    expect(exercisePayloadSchema.safeParse(payload({ movement_pattern: "leg_day" })).success)
      .toBe(false);
  });
});
