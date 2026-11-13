import type { PlateInventoryItem } from "@/api/types";

export type { PlateInventoryItem } from "@/api/types";

export interface PlateLoad {
  requested_weight_kg: number;
  achieved_weight_kg: number;
  exact: boolean;
  per_side: number[];
}

/** Finds the fewest available plates per side. Plate sizes are quarter-kilo multiples. */
export function calculatePlateLoad(
  requestedWeightKg: number,
  barbellWeightKg: number,
  inventory: PlateInventoryItem[],
): PlateLoad {
  const safeTarget = Number.isFinite(requestedWeightKg) ? Math.max(0, requestedWeightKg) : 0;
  const targetUnits = Math.max(0, Math.floor((safeTarget - barbellWeightKg) * 2 + 1e-8));
  const plates = inventory
    .filter((item) => item.pairs > 0 && item.plate_weight_kg > 0)
    .map((item) => ({ units: Math.round(item.plate_weight_kg * 4), weight: item.plate_weight_kg, pairs: item.pairs }))
    .filter((item) => item.units > 0)
    .sort((left, right) => right.units - left.units);
  const memo = new Map<string, number[] | null>();

  function exactDistribution(index: number, remaining: number): number[] | null {
    if (remaining === 0) return plates.map(() => 0);
    if (index >= plates.length || remaining < 0) return null;
    const key = `${index}:${remaining}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    const plate = plates[index];
    if (!plate) return null;
    const maxCount = Math.min(plate.pairs, Math.floor(remaining / plate.units));
    let best: number[] | null = null;
    let bestCount = Number.POSITIVE_INFINITY;
    for (let count = maxCount; count >= 0; count -= 1) {
      const rest = exactDistribution(index + 1, remaining - count * plate.units);
      if (!rest) continue;
      const totalCount = count + rest.reduce((sum, value) => sum + value, 0);
      if (totalCount < bestCount) {
        best = [count, ...rest];
        bestCount = totalCount;
      }
    }
    memo.set(key, best);
    return best;
  }

  let lowerUnits = targetUnits;
  let lowerDistribution = exactDistribution(0, lowerUnits);
  while (!lowerDistribution && lowerUnits > 0) {
    lowerUnits -= 1;
    lowerDistribution = exactDistribution(0, lowerUnits);
  }
  const maxUnits = plates.reduce((sum, plate) => sum + plate.units * plate.pairs, 0);
  let upperUnits = targetUnits + 1;
  let upperDistribution: number[] | null = null;
  while (!upperDistribution && upperUnits <= maxUnits) {
    upperDistribution = exactDistribution(0, upperUnits);
    if (!upperDistribution) upperUnits += 1;
  }

  const lowerWeight = barbellWeightKg + lowerUnits / 2;
  const upperWeight = barbellWeightKg + upperUnits / 2;
  const useUpper = upperDistribution !== null && (
    lowerDistribution === null || Math.abs(upperWeight - safeTarget) < Math.abs(lowerWeight - safeTarget)
  );
  const achievedUnits = useUpper ? upperUnits : lowerUnits;
  const distribution = useUpper ? upperDistribution : lowerDistribution;
  const perSide = distribution
    ? distribution.flatMap((count, index) => Array.from({ length: count }, () => plates[index]?.weight ?? 0))
    : [];
  const achievedWeight = barbellWeightKg + achievedUnits / 2;
  return {
    requested_weight_kg: requestedWeightKg,
    achieved_weight_kg: achievedWeight,
    exact: Math.abs(achievedWeight - requestedWeightKg) < 1e-8,
    per_side: perSide,
  };
}

export function formatPlateWeight(weightKg: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(weightKg);
}

export interface PlateStock {
  weight_kg: number;
  pairs: number;
}

export interface PlateProfile {
  base_kg: number;
  collars_kg: number;
  plates: readonly PlateStock[];
}

export interface ProfilePlateLoad {
  totalKg: number;
  perSide: { weight_kg: number; count: number }[];
}

export const DEFAULT_BARBELL: PlateProfile = {
  base_kg: 20,
  collars_kg: 0,
  plates: [
    { weight_kg: 25, pairs: 1 },
    { weight_kg: 20, pairs: 2 },
    { weight_kg: 15, pairs: 1 },
    { weight_kg: 10, pairs: 1 },
    { weight_kg: 5, pairs: 1 },
    { weight_kg: 2.5, pairs: 1 },
    { weight_kg: 1.25, pairs: 1 },
  ],
};

function grams(kg: number): number | null {
  const value = Math.round(kg * 1000);
  return kg >= 0 && Number.isSafeInteger(value) && Math.abs(kg * 1000 - value) < 0.000001
    ? value
    : null;
}

interface LoadChoices {
  exact: ProfilePlateLoad | null;
  lower: ProfilePlateLoad | null;
  upper: ProfilePlateLoad | null;
}

/** Finds symmetric stacks with the fewest plates at each weight. Integer
 * grams keep fractional collars and odd-gram requests exact. */
export function solvePlateLoad(targetKg: number, profile: PlateProfile): LoadChoices | null {
  const target = grams(targetKg);
  const base = grams(profile.base_kg);
  const collars = grams(profile.collars_kg);
  if (target === null || base === null || collars === null) return null;

  const stock = new Map<number, number>();
  for (const { weight_kg, pairs } of profile.plates) {
    const mass = grams(weight_kg);
    if (!mass || !Number.isSafeInteger(pairs) || pairs < 0) return null;
    if (pairs) stock.set(mass, (stock.get(mass) ?? 0) + pairs);
  }
  const inventory = [...stock].sort(([left], [right]) => right - left);
  const fixed = base + collars;
  // The nearest upper stack can exceed the target by at most one plate.
  // Otherwise removing a plate would give a nearer supported load.
  const limitPerSide = Math.max(0, (target - fixed) / 2) + (inventory[0]?.[0] ?? 0);
  const reachable = new Map<number, { count: number; perSide: ProfilePlateLoad["perSide"] }>([
    [0, { count: 0, perSide: [] }],
  ]);
  for (const [mass, pairs] of inventory) {
    // Use the previous denomination's states to respect this plate's stock.
    const previous = [...reachable];
    for (const [side, stack] of previous) {
      for (let count = 1; count <= pairs; count += 1) {
        const next = side + mass * count;
        if (next > limitPerSide) break;
        const plateCount = stack.count + count;
        const current = reachable.get(next);
        if (current && current.count <= plateCount) continue;
        reachable.set(next, {
          count: plateCount,
          perSide: [...stack.perSide, { weight_kg: mass / 1000, count }],
        });
      }
    }
  }

  const choices: LoadChoices = { exact: null, lower: null, upper: null };
  for (const [side, stack] of reachable) {
    const total = fixed + 2 * side;
    const load = { totalKg: total / 1000, perSide: stack.perSide };
    if (total === target) choices.exact = load;
    if (total < target && (!choices.lower || load.totalKg > choices.lower.totalKg)) choices.lower = load;
    if (total > target && (!choices.upper || load.totalKg < choices.upper.totalKg)) choices.upper = load;
  }
  return choices;
}
