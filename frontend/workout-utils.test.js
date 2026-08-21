import { describe, expect, it } from "vitest";

import {
  buildWorkoutGrid,
  groupSessionExercises,
  parseRepsPerSet,
  remainingTimeSeconds,
  resolveSetDisplayState,
  workoutProgress,
} from "../app/static/workout-utils.js";

describe("parseRepsPerSet", () => {
  it("normalizes comma-separated set repetitions", () => {
    expect(parseRepsPerSet("10, 8,, 6")).toEqual([10, 8, 6]);
  });
});

describe("resolveSetDisplayState", () => {
  it("marks plan values as visibly unsaved suggestions", () => {
    expect(
      resolveSetDisplayState({
        savedEntry: null,
        suggestedWeightKg: 42.5,
        suggestedReps: 8,
        suggestionSource: "plan",
      })
    ).toEqual({
      weightKg: 42.5,
      reps: 8,
      rir: null,
      isSaved: false,
      label: "Suggested from plan · not saved",
    });
  });

  it("prefers persisted values and marks them saved", () => {
    expect(
      resolveSetDisplayState({
        savedEntry: { weight_kg: 47.5, reps: 7, rir: 2 },
        suggestedWeightKg: 42.5,
        suggestedReps: 8,
        suggestionSource: "plan",
      })
    ).toEqual({
      weightKg: 47.5,
      reps: 7,
      rir: 2,
      isSaved: true,
      label: "Saved",
    });
  });
});

describe("remainingTimeSeconds", () => {
  it("derives remaining time from an absolute timestamp", () => {
    expect(
      remainingTimeSeconds("2026-08-22T10:01:30.000Z", new Date("2026-08-22T10:00:00.000Z"))
    ).toBe(90);
  });

  it("never returns a negative value", () => {
    expect(
      remainingTimeSeconds("2026-08-22T09:59:59.000Z", new Date("2026-08-22T10:00:00.000Z"))
    ).toBe(0);
  });
});

const session = {
  focused_exercise_id: "exercise-b",
  focused_set_number: 1,
  exercises: [
    {
      id: "exercise-a",
      sort_order: 0,
      exercise_name: "Squat",
      target_sets: 2,
      suggested_weight_kg: 80,
      suggested_reps: 5,
      suggestion_source: "plan",
      group_key: null,
      group_order: null,
      set_entries: [
        { id: "set-a-1", set_number: 1, weight_kg: 82.5, reps: 6, rir: 2, state: "completed" },
        { id: "set-a-2", set_number: 2, weight_kg: 80, reps: 5, rir: null, state: "skipped" },
      ],
    },
    {
      id: "exercise-b",
      sort_order: 1,
      exercise_name: "Row",
      target_sets: 2,
      suggested_weight_kg: 40,
      suggested_reps: 8,
      suggestion_source: "history",
      group_key: "superset-a",
      group_order: 0,
      set_entries: [],
    },
  ],
};

describe("Slice 2 workout grid", () => {
  it("derives completed, skipped, current, and future rows", () => {
    expect(buildWorkoutGrid(session).map((row) => row.state)).toEqual([
      "completed",
      "skipped",
      "current",
      "future",
    ]);
  });

  it("counts completed and skipped sets as progress", () => {
    expect(workoutProgress(session)).toEqual({ done: 2, total: 4, percent: 50 });
  });

  it("keeps linked exercises in one ordered group", () => {
    expect(groupSessionExercises(session.exercises).map((group) => group.key)).toEqual([
      "exercise:exercise-a",
      "superset-a",
    ]);
  });
});
