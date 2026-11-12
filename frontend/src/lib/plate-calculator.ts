export interface PlateInventoryItem {
  plate_weight_kg: number;
  /** Number of matching pairs available. One plate from each pair goes on each side. */
  pairs: number;
}

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
