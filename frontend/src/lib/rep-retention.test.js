import { describe, expect, it } from "vitest";

import { repRetentionGroups } from "./rep-retention";

describe("repRetentionGroups", () => {
  it("compares reps and preserves set numbers independently at each repeated load", () => {
    expect(repRetentionGroups({
      weight_kg: 70,
      weight_per_set: [60, 50, 60, 50, 70, null],
      reps_per_set: [8, 10, 6, 12, 4, 8],
      rir_per_set: [2, null, 1, 0, null, null],
    })).toEqual([
      {
        weightKg: 60,
        sets: [
          { number: 1, reps: 8, rir: 2, percent: 100 },
          { number: 3, reps: 6, rir: 1, percent: 75 },
        ],
      },
      {
        weightKg: 50,
        sets: [
          { number: 2, reps: 10, rir: null, percent: 100 },
          { number: 4, reps: 12, rir: 0, percent: 120 },
        ],
      },
    ]);
  });

  it("reuses a legacy common weight and omits unknown or zero loads", () => {
    const legacy = { weight_kg: 40, weight_per_set: null, reps_per_set: [8, 4] };
    expect(repRetentionGroups(legacy)[0].sets.map(({ percent }) => percent)).toEqual([100, 50]);
    expect(repRetentionGroups({ ...legacy, weight_per_set: [null, 0] })).toEqual([]);
    expect(repRetentionGroups({ ...legacy, weight_kg: null })).toEqual([]);
  });
});
