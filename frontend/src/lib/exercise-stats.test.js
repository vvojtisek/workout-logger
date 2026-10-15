import { describe, expect, it } from "vitest";

import { exerciseStatsFacts } from "./exercise-stats";

/** @type {import("@/api/types").ExerciseStats} */
const base = {
  exercise_name: "Floor press",
  sessions_count: 3,
  last_performed_at: "2026-10-12T08:00:00Z",
  last_weight_kg: 30,
  last_reps_per_set: [15, 12],
  best_weight_kg: 32.5,
  best_weight_reps: 10,
  estimated_one_rep_max_kg: 45,
  trend: "down",
  recent: [],
};

describe("exerciseStatsFacts", () => {
  it("is empty for an exercise with no history", () => {
    expect(exerciseStatsFacts(undefined)).toEqual([]);
    expect(exerciseStatsFacts({ ...base, sessions_count: 0 })).toEqual([]);
  });

  it("summarizes last session, best set, estimated 1RM and trend", () => {
    const facts = exerciseStatsFacts(base);
    expect(facts[0]).toMatch(/^Last .+: 30 kg × 15\/12$/);
    expect(facts.slice(1)).toEqual(["Best 32.5 kg × 10", "e1RM 45 kg", "load down"]);
  });

  it("shows reps only for unloaded exercises", () => {
    const facts = exerciseStatsFacts({
      ...base,
      last_weight_kg: null,
      last_reps_per_set: [6, 10],
      best_weight_kg: null,
      best_weight_reps: null,
      estimated_one_rep_max_kg: null,
      trend: null,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatch(/: 6\/10 reps$/);
  });
});
