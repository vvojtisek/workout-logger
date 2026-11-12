import { describe, expect, it } from "vitest";

import { solvePlateLoad } from "./plate-calculator";

describe("barbell plate distribution", () => {
  it("finds an exact stack when starting with the heaviest plate would fail", () => {
    const load = solvePlateLoad(82, {
      base_kg: 20,
      collars_kg: 2,
      plates: [{ weight_kg: 20, pairs: 1 }, { weight_kg: 15, pairs: 2 }],
    });
    expect(load?.exact).toEqual({ totalKg: 82, perSide: [{ weight_kg: 15, count: 2 }] });
  });

  it("chooses an exact load with the fewest plates per side", () => {
    const load = solvePlateLoad(60, {
      base_kg: 20,
      collars_kg: 0,
      plates: [{ weight_kg: 10, pairs: 2 }, { weight_kg: 20, pairs: 1 }],
    });
    expect(load?.exact).toEqual({ totalKg: 60, perSide: [{ weight_kg: 20, count: 1 }] });
  });

  it("reports the nearest supported weights on both sides of an unavailable load", () => {
    const load = solvePlateLoad(62.501, {
      base_kg: 20,
      collars_kg: 0,
      plates: [{ weight_kg: 20, pairs: 1 }, { weight_kg: 2.5, pairs: 1 }],
    });
    expect(load?.exact).toBeNull();
    expect(load?.lower?.totalKg).toBe(60);
    expect(load?.upper?.totalKg).toBe(65);
  });

  it("handles the bare bar and the stock ceiling without rounding the target", () => {
    const profile = { base_kg: 20, collars_kg: 0.125, plates: [{ weight_kg: 0.25, pairs: 1 }] };
    expect(solvePlateLoad(20, profile)).toMatchObject({
      exact: null, lower: null, upper: { totalKg: 20.125, perSide: [] },
    });
    expect(solvePlateLoad(21, profile)).toMatchObject({
      exact: null, lower: { totalKg: 20.625 }, upper: null,
    });
    expect(solvePlateLoad(20.6251, profile)).toBeNull();
  });
});
