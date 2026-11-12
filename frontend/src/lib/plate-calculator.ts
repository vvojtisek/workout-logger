export interface PlateStock {
  weight_kg: number;
  pairs: number;
}

export interface PlateProfile {
  base_kg: number;
  collars_kg: number;
  plates: readonly PlateStock[];
}

export interface PlateLoad {
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
  exact: PlateLoad | null;
  lower: PlateLoad | null;
  upper: PlateLoad | null;
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
  const reachable = new Map<number, { count: number; perSide: PlateLoad["perSide"] }>([
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
