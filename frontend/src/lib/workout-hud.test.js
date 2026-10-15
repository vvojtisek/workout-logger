import { describe, expect, it } from "vitest";

import {
  exercisePosition,
  formatCountdown,
  formatElapsed,
  hudIndex,
  nextExercise,
  performanceOrder,
  previousExercise,
  previousSet,
  rirPillValue,
  stepValue,
} from "./workout-hud";

/**
 * @param {string} id
 * @param {number} sort
 * @param {number} sets
 * @param {{ group?: string, order?: number, done?: number[] }} [options]
 */
function exercise(id, sort, sets, options = {}) {
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
    set_entries: (options.done ?? []).map((set) => ({
      id: `${id}-${set}`,
      set_number: set,
      weight_kg: 50,
      reps: 8,
      rir: 2,
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

/** @param {ReturnType<typeof exercise>[]} exercises @param {string | null} focusId @param {number} focusSet */
function session(exercises, focusId = null, focusSet = 1) {
  return { exercises, focused_exercise_id: focusId, focused_set_number: focusSet };
}

/** @param {import("./workout-hud").HudRow[]} rows */
function labels(rows) {
  return rows.map((row) => `${row.exercise.id}${row.setNumber}${row.badge ? `(${row.badge})` : ""}`);
}

const PLAN = [
  exercise("squat", 0, 2),
  exercise("row", 1, 2, { group: "pull", order: 0 }),
  exercise("push", 2, 2, { group: "pull", order: 1 }),
];

describe("performanceOrder", () => {
  it("lists straight sets in order and interleaves supersets by round", () => {
    expect(labels(performanceOrder(session(PLAN)))).toEqual([
      "squat1",
      "squat2",
      "row1(A1)",
      "push1(A2)",
      "row2(A1)",
      "push2(A2)",
    ]);
  });
});

describe("hudIndex", () => {
  it("shows the focused set", () => {
    const s = session(PLAN, "push", 1);
    expect(hudIndex(s, performanceOrder(s))).toBe(3);
  });

  it("falls back to the first unlogged set, then the last set", () => {
    const partial = session([exercise("squat", 0, 2, { done: [1] })]);
    expect(hudIndex(partial, performanceOrder(partial))).toBe(1);
    const done = session([exercise("squat", 0, 2, { done: [1, 2] })]);
    expect(hudIndex(done, performanceOrder(done))).toBe(1);
  });
});

describe("pager targets", () => {
  const rows = performanceOrder(session(PLAN));

  it("steps back one set", () => {
    expect(previousSet(rows, 0)).toBeNull();
    expect(labels([/** @type {any} */ (previousSet(rows, 3))])).toEqual(["row1(A1)"]);
  });

  it("jumps to the next exercise, preferring an unlogged set", () => {
    expect(labels([/** @type {any} */ (nextExercise(rows, 0))])).toEqual(["row1(A1)"]);
    expect(labels([/** @type {any} */ (nextExercise(rows, 2))])).toEqual(["push1(A2)"]);
    expect(nextExercise(rows, 5)).toBeNull();
    const logged = performanceOrder(
      session([exercise("squat", 0, 2), exercise("bench", 1, 3, { done: [1] })]),
    );
    expect(labels([/** @type {any} */ (nextExercise(logged, 0))])).toEqual(["bench2"]);
  });

  it("jumps back to the previous exercise", () => {
    expect(previousExercise(rows, 0)).toBeNull();
    expect(labels([/** @type {any} */ (previousExercise(rows, 2))])).toEqual(["squat1"]);
  });

  it("counts exercises, not sets", () => {
    expect(exercisePosition(rows, 3)).toEqual({ index: 3, total: 3 });
    expect(exercisePosition(rows, 1)).toEqual({ index: 1, total: 3 });
  });
});

describe("formatting and steppers", () => {
  it("steps without float noise and never below the minimum", () => {
    expect(stepValue("70", 2.5, 0)).toBe("72.5");
    expect(stepValue("0.1", 0.2, 0)).toBe("0.3");
    expect(stepValue("1", -2.5, 0)).toBe("0");
    expect(stepValue("", 1, 1)).toBe("1");
  });

  it("formats the rest countdown and session clock", () => {
    expect(formatCountdown(75)).toBe("01:15");
    expect(formatCountdown(-3)).toBe("00:00");
    const start = "2026-10-15T10:00:00Z";
    expect(formatElapsed(start, new Date("2026-10-15T10:42:18Z"))).toBe("00:42:18");
  });

  it("maps any RIR of 4 or more onto the 4+ pill", () => {
    expect(rirPillValue("2")).toBe("2");
    expect(rirPillValue("7")).toBe("4");
    expect(rirPillValue("")).toBe("");
  });
});
