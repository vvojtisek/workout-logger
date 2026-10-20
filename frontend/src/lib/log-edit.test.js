import { describe, expect, it } from "vitest";

import {
  addSet,
  draftToPatch,
  exerciseSetsText,
  logToDraft,
  newExercise,
  removeSet,
} from "./log-edit";

/** @param {Partial<import("@/api/types").WorkoutLog>} overrides */
function makeLog(overrides = {}) {
  return {
    id: "log-1",
    source_plan_id: null,
    source_plan_name: "Push",
    performed_at: new Date(2026, 9, 18, 7, 30).toISOString(),
    total_time_minutes: 40,
    calories_burned: null,
    overall_feeling: 4,
    notes: "felt fine",
    activity_type: null,
    distance_km: null,
    effort_rpe: null,
    exercises: [
      {
        id: "ex-1",
        exercise_name: "Bench press",
        sets_count: 2,
        reps_per_set: [8, 6],
        weight_kg: 62.5,
        weight_per_set: [60, 62.5],
        rir_per_set: [2, null],
        rest_time_seconds: 120,
        notes: null,
        future_field: "kept",
      },
    ],
    ...overrides,
  };
}

describe("logToDraft", () => {
  it("lists each set with its own weight and RIR", () => {
    const draft = logToDraft(makeLog());
    expect(draft.performedAt).toBe("2026-10-18 07:30");
    expect(draft.exercises[0].sets.map(({ weight, reps, rir }) => [weight, reps, rir])).toEqual([
      ["60", "8", "2"],
      ["62.5", "6", ""],
    ]);
  });

  it("uses the single logged weight for every set of an older log", () => {
    const log = makeLog();
    log.exercises[0].weight_per_set = null;
    log.exercises[0].rir_per_set = null;
    const sets = logToDraft(log).exercises[0].sets;
    expect(sets.map((set) => set.weight)).toEqual(["62.5", "62.5"]);
    expect(sets.map((set) => set.rir)).toEqual(["", ""]);
  });
});

describe("addSet / removeSet", () => {
  it("copies the last set so a repeat is one tap", () => {
    const exercise = addSet(logToDraft(makeLog()).exercises[0]);
    expect(exercise.sets).toHaveLength(3);
    expect(exercise.sets[2]).toMatchObject({ weight: "62.5", reps: "6", rir: "" });
    expect(new Set(exercise.sets.map((set) => set.key)).size).toBe(3);
  });

  it("starts a new exercise with one empty set", () => {
    expect(addSet(newExercise()).sets).toHaveLength(2);
    expect(newExercise().sets[0]).toMatchObject({ weight: "", reps: "", rir: "" });
  });

  it("removes a set by key", () => {
    const exercise = logToDraft(makeLog()).exercises[0];
    expect(removeSet(exercise, exercise.sets[0].key).sets.map((set) => set.reps)).toEqual(["6"]);
  });
});

/**
 * The PATCH body, failing the test if the draft was rejected.
 * @param {import("./log-edit").LogDraft} draft
 */
function patchOf(draft) {
  const result = draftToPatch(draft);
  if (result.patch === null) throw new Error(result.error);
  return result.patch;
}

/** @type {[string, (draft: import("./log-edit").LogDraft) => unknown, RegExp][]} */
const BAD_DRAFTS = [
  ["date", (d) => (d.performedAt = "18/10/2026 07:30"), /date and time/],
  ["minutes", (d) => (d.totalTime = "0"), /Duration/],
  ["name", (d) => (d.exercises[0].exercise_name = " "), /name/],
  ["reps", (d) => (d.exercises[0].sets[0].reps = "0"), /Bench press set 1: reps/],
  ["weight", (d) => (d.exercises[0].sets[0].weight = "-5"), /Bench press set 1: weight/],
  ["rir", (d) => (d.exercises[0].sets[1].rir = "11"), /Bench press set 2: RIR/],
  ["no sets", (d) => (d.exercises[0].sets = []), /Bench press has no sets/],
];

describe("draftToPatch", () => {
  it("sends edited sets and keeps fields it does not edit", () => {
    const draft = logToDraft(makeLog());
    draft.notes = "";
    draft.exercises[0].sets[1].rir = "1";
    draft.exercises[0] = addSet(draft.exercises[0]);
    const patch = patchOf(draft);
    expect(patch.notes).toBeNull();
    expect(patch.total_time_minutes).toBe(40);
    expect(patch.performed_at).toBe(new Date(2026, 9, 18, 7, 30).toISOString());
    expect(patch.exercises).toEqual([
      {
        exercise_name: "Bench press",
        sets_count: 3,
        reps_per_set: [8, 6, 6],
        weight_kg: 62.5,
        weight_per_set: [60, 62.5, 62.5],
        rir_per_set: [2, 1, null],
        rest_time_seconds: 120,
        notes: null,
        future_field: "kept",
      },
    ]);
  });

  it("drops a removed exercise and adds a new one", () => {
    const draft = logToDraft(makeLog());
    const added = newExercise();
    added.exercise_name = " Row ";
    added.sets[0] = { ...added.sets[0], weight: "", reps: "12" };
    draft.exercises = [added];
    expect(patchOf(draft).exercises).toEqual([
      {
        exercise_name: "Row",
        sets_count: 1,
        reps_per_set: [12],
        weight_kg: null,
        weight_per_set: [null],
        rir_per_set: [null],
        rest_time_seconds: 60,
        notes: null,
      },
    ]);
  });

  it.each(BAD_DRAFTS)("rejects a bad %s", (_, mutate, message) => {
    const draft = logToDraft(makeLog());
    mutate(draft);
    const result = draftToPatch(draft);
    expect(result.patch).toBeNull();
    expect(result.error).toMatch(message);
  });
});

describe("exerciseSetsText", () => {
  it("names each set's weight when they differ", () => {
    expect(exerciseSetsText(makeLog().exercises[0])).toBe("60 kg × 8, 62.5 kg × 6");
  });

  it("keeps the short form for one weight", () => {
    const exercise = { ...makeLog().exercises[0], weight_per_set: [62.5, 62.5] };
    expect(exerciseSetsText(exercise)).toBe("8, 6 reps @ 62.5kg");
    expect(exerciseSetsText({ ...exercise, weight_per_set: null })).toBe("8, 6 reps @ 62.5kg");
  });
});
