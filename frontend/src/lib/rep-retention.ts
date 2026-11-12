import type { ExerciseLog } from "@/api/types";

export interface RetentionSet {
  number: number;
  reps: number;
  rir: number | null;
  repsAtFailure: number | null;
  percent: number;
  failurePercent: number | null;
}

export interface RetentionGroup {
  weightKg: number;
  sets: RetentionSet[];
}

export function repRetentionGroups(
  exercise: Pick<ExerciseLog, "weight_kg" | "weight_per_set" | "reps_per_set" | "rir_per_set">,
): RetentionGroup[] {
  const groups = new Map<number, RetentionGroup>();
  const weights = exercise.weight_per_set;
  for (const [index, reps] of exercise.reps_per_set.entries()) {
    const weightKg = weights?.length ? weights[index] : exercise.weight_kg;
    if (weightKg == null || weightKg <= 0 || reps <= 0) continue;
    const group = groups.get(weightKg) ?? { weightKg, sets: [] };
    const reference = group.sets[0]?.reps ?? reps;
    const rir = exercise.rir_per_set?.[index] ?? null;
    group.sets.push({
      number: index + 1,
      reps,
      rir,
      repsAtFailure: rir === null ? null : reps + rir,
      percent: (reps / reference) * 100,
      failurePercent: null,
    });
    groups.set(weightKg, group);
  }
  return [...groups.values()]
    .filter((group) => group.sets.length > 1)
    .map((group) => {
      const baseline = group.sets.find((set) => set.repsAtFailure !== null)?.repsAtFailure;
      return {
        ...group,
        sets: group.sets.map((set) => ({
          ...set,
          failurePercent:
            baseline !== undefined && baseline !== null && set.repsAtFailure !== null
              ? (set.repsAtFailure / baseline) * 100
              : null,
        })),
      };
    });
}
