import { describe, expect, it } from "vitest";

import {
  applyOptimisticSet,
  applyPendingSets,
  isPendingEntry,
} from "./optimistic-session";

const NOW = new Date("2026-11-13T10:00:00.000Z");

/** @param {string} id @param {number} sort @param {number} sets @param {number[]} [done] */
function exercise(id, sort, sets, done = []) {
  return {
    id,
    sort_order: sort,
    exercise_name: id,
    exercise_kind: /** @type {const} */ ("strength"),
    target_sets: sets,
    target_reps_min: 5,
    target_reps_max: 8,
    target_weight_kg: 80,
    target_rir: null,
    rest_time_seconds: 90,
    notes: null,
    status: "active",
    suggested_weight_kg: 80,
    suggested_reps: 5,
    suggestion_source: "plan",
    group_key: null,
    group_order: null,
    set_entries: done.map((set) => ({
      id: `${id}-${set}`,
      set_number: set,
      weight_kg: 80,
      reps: 5,
      rir: null,
      added_weight_kg: null,
      band_level: null,
      duration_seconds: null,
      distance_km: null,
      incline_percent: null,
      rpe: null,
      state: "completed",
    })),
  };
}

function session() {
  return {
    id: "s1",
    source_plan_id: null,
    source_plan_name: "Plan",
    owner_id: null,
    location: null,
    location_id: null,
    workout_log_id: null,
    status: "active",
    started_at: "2026-11-13T09:00:00.000Z",
    completed_at: null,
    rest_ends_at: null,
    version: 4,
    focused_exercise_id: "squat",
    focused_set_number: 1,
    exercises: [exercise("squat", 0, 2), exercise("row", 1, 1)],
  };
}

const payload = (extra = {}) => ({
  session_exercise_id: "squat",
  set_number: 1,
  weight_kg: 82.5,
  reps: 6,
  rir: 2,
  state: "completed",
  client_operation_id: "op-1",
  ...extra,
});

describe("applyOptimisticSet", () => {
  it("records the set locally, marked pending, with the values that were logged", () => {
    const next = applyOptimisticSet(session(), payload(), NOW);
    const entry = next.exercises[0].set_entries[0];
    expect(entry).toMatchObject({ set_number: 1, weight_kg: 82.5, reps: 6, rir: 2, state: "completed" });
    expect(isPendingEntry(entry)).toBe(true);
  });

  it("starts the exercise's rest right away and moves focus to the next open set", () => {
    const next = applyOptimisticSet(session(), payload(), NOW);
    expect(next.rest_ends_at).toBe("2026-11-13T10:01:30.000Z");
    expect(next.focused_exercise_id).toBe("squat");
    expect(next.focused_set_number).toBe(2);
  });

  it("moves on to the next exercise once the last set of one is logged", () => {
    const base = session();
    base.exercises[0] = exercise("squat", 0, 2, [1]);
    base.focused_set_number = 2;
    const next = applyOptimisticSet(base, payload({ set_number: 2, client_operation_id: "op-2" }), NOW);
    expect(next.focused_exercise_id).toBe("row");
    expect(next.focused_set_number).toBe(1);
  });

  it("does not start a rest for a skipped set", () => {
    const next = applyOptimisticSet(session(), payload({ state: "skipped" }), NOW);
    expect(next.rest_ends_at).toBeNull();
    expect(next.exercises[0].set_entries[0].state).toBe("skipped");
  });

  it("never overrides a set the server already has, and leaves its input untouched", () => {
    const base = session();
    base.exercises[0] = exercise("squat", 0, 2, [1]);
    const next = applyOptimisticSet(base, payload(), NOW);
    expect(next).toBe(base);
  });

  it("does not mutate the session it was given", () => {
    const base = session();
    applyOptimisticSet(base, payload(), NOW);
    expect(base.exercises[0].set_entries).toHaveLength(0);
    expect(base.rest_ends_at).toBeNull();
  });
});

describe("applyPendingSets", () => {
  it("replays only this session's queued sets, in order", () => {
    const queue = [
      { client_operation_id: "op-1", session_id: "s1", payload: payload() },
      { client_operation_id: "op-2", session_id: "other", payload: payload({ set_number: 2, client_operation_id: "op-2" }) },
      { client_operation_id: "op-3", session_id: "s1", payload: payload({ set_number: 2, client_operation_id: "op-3" }) },
    ];
    const next = applyPendingSets(session(), queue, NOW);
    expect(next.exercises[0].set_entries.map((entry) => entry.set_number)).toEqual([1, 2]);
  });

  it("returns the same session when nothing is queued", () => {
    const base = session();
    expect(applyPendingSets(base, [], NOW)).toBe(base);
  });
});
