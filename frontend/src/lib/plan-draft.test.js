import { describe, expect, it } from "vitest";

import {
  buildPayload,
  emptyRow,
  planSummary,
  rowFromExercise,
  supersetLabels,
} from "./plan-draft";

/** @type {import("@/api/types").PlanExercise} */
const squat = {
  id: "e1",
  sort_order: 0,
  exercise_name: "Back Squat",
  exercise_kind: "strength",
  target_sets: 4,
  target_reps_min: 5,
  target_reps_max: 8,
  target_weight_kg: 100,
  rest_time_seconds: 120,
  target_rir: 2,
  notes: null,
  group_key: null,
  group_order: null,
};

describe("plan drafts", () => {
  it("round-trips an exercise through a row and back to the payload", () => {
    const payload = buildPayload("Legs", "", [rowFromExercise(squat)]);
    expect(payload.exercises[0]).toMatchObject({
      exercise_name: "Back Squat",
      target_sets: 4,
      target_weight_kg: 100,
      target_rir: 2,
          group_key: null,
    });
  });

  it("drops RIR on non-strength exercises", () => {
    const row = { ...rowFromExercise(squat), exercise_kind: /** @type {const} */ ("bodyweight"), target_rir: "2" };
    expect(buildPayload("p", "", [row]).exercises[0].target_rir).toBeNull();
  });

  it("treats a blank RIR as not prescribed and keeps RIR 0", () => {
    const blank = { ...rowFromExercise(squat), target_rir: "" };
    const zero = { ...rowFromExercise(squat), target_rir: "0" };
    expect(buildPayload("p", "", [blank]).exercises[0].target_rir).toBeNull();
    expect(buildPayload("p", "", [zero]).exercises[0].target_rir).toBe(0);
  });

  it("numbers superset members in row order", () => {
    const a = { ...emptyRow(), exercise_name: "A", group_key: " S " };
    const b = { ...emptyRow(), exercise_name: "B", group_key: "S" };
    const [x, y] = buildPayload("p", "", [a, b]).exercises;
    expect([x.group_key, x.group_order, y.group_order]).toEqual(["S", 0, 1]);
  });

  it("starts new rows bilateral with no RIR", () => {
    expect(emptyRow(90)).toMatchObject({ target_rir: "", rest_time_seconds: "90" });
  });

  it("summarises sets and a sensible duration", () => {
    const rows = [rowFromExercise(squat), { ...rowFromExercise(squat), target_sets: "3" }];
    expect(planSummary(rows)).toEqual({ exercises: 2, sets: 7 });
  });

  it("letters superset groups A, B in order of first appearance", () => {
    const rows = ["x", "", "y", "x"].map((g) => ({ ...emptyRow(), group_key: g }));
    expect(supersetLabels(rows)).toEqual(["A", "", "B", "A"]);
  });
});
