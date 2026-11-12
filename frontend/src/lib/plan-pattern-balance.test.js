import { describe, expect, it } from "vitest";

import { summarizePlanPatterns } from "./plan-pattern-balance";

describe("summarizePlanPatterns", () => {
  it("groups target sets by the catalogue movement pattern using names or aliases", () => {
    const summary = summarizePlanPatterns(
      [
        { exercise_name: "Back squat", target_sets: "4" },
        { exercise_name: "Romanian deadlift", target_sets: "3" },
        { exercise_name: "unreviewed drill", target_sets: "2" },
      ],
      [
        { id: "1", name: "Barbell squat", aliases: ["Back squat"], movement_pattern: "squat" },
        { id: "2", name: "RDL", aliases: ["Romanian deadlift"], movement_pattern: "hinge" },
      ],
    );

    expect(summary).toEqual([
      { movement_pattern: "squat", exercise_count: 1, target_sets: 4 },
      { movement_pattern: "hinge", exercise_count: 1, target_sets: 3 },
      { movement_pattern: null, exercise_count: 1, target_sets: 2 },
    ]);
  });

  it("keeps ambiguous aliases and unclassified catalogue entries unclassified", () => {
    const summary = summarizePlanPatterns(
      [
        { exercise_name: "Shared alias", target_sets: "2" },
        { exercise_name: "Legacy lift", target_sets: "3" },
        { exercise_name: "", target_sets: "4" },
        { exercise_name: "Bad dose", target_sets: "0" },
      ],
      [
        { id: "1", name: "Push exercise", aliases: ["Shared alias"], movement_pattern: "horizontal_push" },
        { id: "2", name: "Pull exercise", aliases: ["Shared alias"], movement_pattern: "horizontal_pull" },
        { id: "3", name: "Legacy lift", aliases: [], movement_pattern: null },
      ],
    );

    expect(summary).toEqual([
      { movement_pattern: null, exercise_count: 2, target_sets: 5 },
    ]);
  });
});
