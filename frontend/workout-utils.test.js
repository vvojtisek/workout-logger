import { describe, expect, it } from "vitest";

import {
  parseRepsPerSet,
  remainingTimeSeconds,
  resolveSetDisplayState,
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
