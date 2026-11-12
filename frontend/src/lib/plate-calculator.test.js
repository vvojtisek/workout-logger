import { describe, expect, it } from "vitest";

import { calculatePlateLoad } from "./plate-calculator";

const inventory = [
  { plate_weight_kg: 20, pairs: 4 },
  { plate_weight_kg: 10, pairs: 4 },
  { plate_weight_kg: 1.25, pairs: 4 },
];

describe("calculatePlateLoad", () => {
  it("returns the smallest exact per-side plate distribution", () => {
    expect(calculatePlateLoad(82.5, 20, inventory)).toEqual({
      requested_weight_kg: 82.5,
      achieved_weight_kg: 82.5,
      exact: true,
      per_side: [20, 10, 1.25],
    });
  });

  it("uses available pair counts and reports the nearest achievable load", () => {
    expect(
      calculatePlateLoad(90, 20, [{ plate_weight_kg: 20, pairs: 1 }]),
    ).toEqual({
      requested_weight_kg: 90,
      achieved_weight_kg: 60,
      exact: false,
      per_side: [20],
    });
  });

  it("finds a combination when taking the largest plate first would strand the remainder", () => {
    expect(
      calculatePlateLoad(31, 20, [
        { plate_weight_kg: 5, pairs: 1 },
        { plate_weight_kg: 3.5, pairs: 2 },
        { plate_weight_kg: 2, pairs: 2 },
      ]),
    ).toMatchObject({ achieved_weight_kg: 31, exact: true, per_side: [3.5, 2] });
  });

  it("rejects a target below the configured bar weight", () => {
    expect(calculatePlateLoad(15, 20, inventory)).toEqual({
      requested_weight_kg: 15,
      achieved_weight_kg: 20,
      exact: false,
      per_side: [],
    });
  });

  it("chooses an achievable load above the target when it is closer", () => {
    expect(
      calculatePlateLoad(24, 20, [{ plate_weight_kg: 2.5, pairs: 1 }]),
    ).toMatchObject({ achieved_weight_kg: 25, exact: false, per_side: [2.5] });
  });
});
