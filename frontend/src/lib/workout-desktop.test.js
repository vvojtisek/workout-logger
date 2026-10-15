import { describe, expect, it } from "vitest";

import {
  copyDraftFrom,
  exerciseSummaries,
  lastCompletedEntry,
  progressionChart,
  targetText,
} from "./workout-desktop";
import { performanceOrder } from "./workout-hud";

/**
 * @param {string} id
 * @param {number} sort
 * @param {number} sets
 * @param {{ group?: string, order?: number, done?: number[], skipped?: number[] }} [options]
 */
function exercise(id, sort, sets, options = {}) {
  /** @param {number} set @param {string} state */
  const entry = (set, state) => ({
    id: `${id}-${set}`,
    set_number: set,
    weight_kg: 50 + set,
    reps: 8,
    rir: 2,
    added_weight_kg: null,
    band_level: null,
    duration_seconds: null,
    distance_km: null,
    incline_percent: null,
    rpe: null,
    state,
  });
  return {
    id,
    sort_order: sort,
    exercise_name: id,
    exercise_kind: /** @type {const} */ ("strength"),
    target_sets: sets,
    suggested_weight_kg: 50,
    suggested_reps: 8,
    suggestion_source: "plan",
    group_key: options.group ?? null,
    group_order: options.order ?? null,
    set_entries: [
      ...(options.done ?? []).map((set) => entry(set, "completed")),
      ...(options.skipped ?? []).map((set) => entry(set, "skipped")),
    ],
  };
}

describe("exerciseSummaries", () => {
  it("lists exercises in performance order with badges and completion", () => {
    const session = {
      focused_exercise_id: null,
      focused_set_number: 1,
      exercises: [
        exercise("squat", 0, 2, { done: [1, 2] }),
        exercise("row", 1, 2, { group: "a", order: 0, done: [1] }),
        exercise("press", 2, 2, { group: "a", order: 1 }),
      ],
    };
    const summaries = exerciseSummaries(performanceOrder(session));
    expect(
      summaries.map(({ exercise: item, badge, logged, total, status }) => ({
        id: item.id,
        badge,
        logged,
        total,
        status,
      })),
    ).toEqual([
      { id: "squat", badge: null, logged: 2, total: 2, status: "done" },
      { id: "row", badge: "A1", logged: 1, total: 2, status: "partial" },
      { id: "press", badge: "A2", logged: 0, total: 2, status: "todo" },
    ]);
    expect(summaries[1].openRow?.setNumber).toBe(2);
    expect(summaries[0].openRow?.setNumber).toBe(1);
  });

  it("counts a skipped set as handled", () => {
    const session = {
      focused_exercise_id: null,
      focused_set_number: 1,
      exercises: [exercise("squat", 0, 2, { done: [1], skipped: [2] })],
    };
    expect(exerciseSummaries(performanceOrder(session))[0].status).toBe("done");
  });
});

describe("targetText", () => {
  it("shows sets, rep range and load", () => {
    expect(
      targetText({
        target_sets: 4,
        target_reps_min: 8,
        target_reps_max: 12,
        target_weight_kg: 70,
        exercise_kind: "strength",
      }),
    ).toBe("4 × 8–12 @ 70 kg");
  });

  it("drops the range and load when there is none", () => {
    expect(
      targetText({
        target_sets: 3,
        target_reps_min: 10,
        target_reps_max: 10,
        target_weight_kg: null,
        exercise_kind: "bodyweight",
      }),
    ).toBe("3 × 10");
    expect(
      targetText({
        target_sets: 1,
        target_reps_min: 1,
        target_reps_max: 1,
        target_weight_kg: null,
        exercise_kind: "cardio",
      }),
    ).toBe("1 set");
  });
});

describe("copy last set", () => {
  it("finds the highest completed set, ignoring skipped ones", () => {
    const item = exercise("squat", 0, 4, { done: [1, 2], skipped: [3] });
    expect(lastCompletedEntry(item)?.set_number).toBe(2);
    expect(lastCompletedEntry(exercise("x", 0, 2))).toBeNull();
  });

  it("turns an entry into a draft without RIR", () => {
    const entry = lastCompletedEntry(exercise("squat", 0, 2, { done: [1] }));
    if (!entry) throw new Error("fixture has a completed set");
    expect(copyDraftFrom(entry)).toEqual({
      weight: "51",
      reps: "8",
      rir: "",
      added_weight_kg: "",
      band_level: "",
      duration_seconds: "",
      distance_km: "",
      incline_percent: "",
    });
  });
});

describe("progressionChart", () => {
  it("scales e1RM points into the box, oldest on the left", () => {
    const chart = progressionChart(
      [
        { performed_at: "2026-09-01T10:00:00Z", weight_kg: 50, top_reps: 8, estimated_one_rep_max_kg: 60 },
        { performed_at: "2026-09-08T10:00:00Z", weight_kg: 55, top_reps: 8, estimated_one_rep_max_kg: 70 },
        { performed_at: "2026-09-15T10:00:00Z", weight_kg: 60, top_reps: 8, estimated_one_rep_max_kg: 80 },
      ],
      200,
      100,
    );
    expect(chart?.min).toBe(60);
    expect(chart?.max).toBe(80);
    expect(chart?.points.map((point) => [point.x, point.y])).toEqual([
      [0, 100],
      [100, 50],
      [200, 0],
    ]);
  });

  it("centres a single or flat series and skips sessions without an estimate", () => {
    const chart = progressionChart(
      [
        { performed_at: "2026-09-01T10:00:00Z", weight_kg: null, top_reps: 10, estimated_one_rep_max_kg: null },
        { performed_at: "2026-09-08T10:00:00Z", weight_kg: 50, top_reps: 5, estimated_one_rep_max_kg: 58 },
      ],
      200,
      100,
    );
    expect(chart?.points.map((point) => [point.x, point.y])).toEqual([[100, 50]]);
    expect(progressionChart([], 200, 100)).toBeNull();
  });
});
