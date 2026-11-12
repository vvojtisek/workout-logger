import { MOVEMENT_PATTERNS } from "@/api/types";
import type { CatalogExercise, MovementPattern } from "@/api/types";

export interface PlannedExerciseDose {
  exercise_name: string;
  target_sets: string | number;
}

export interface PlanPatternSummary {
  movement_pattern: MovementPattern | null;
  exercise_count: number;
  target_sets: number;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Counts prescribed sets by reviewed catalogue pattern; unmatched rows stay explicit. */
export function summarizePlanPatterns(
  plannedExercises: PlannedExerciseDose[],
  catalogue: Pick<CatalogExercise, "id" | "name" | "aliases" | "movement_pattern">[],
): PlanPatternSummary[] {
  const byName = new Map<string, (typeof catalogue)[number] | null>();
  for (const exercise of catalogue) {
    for (const name of [exercise.name, ...exercise.aliases]) {
      const key = normalizeName(name);
      if (!key) continue;
      const existing = byName.get(key);
      if (existing && existing.id !== exercise.id) {
        byName.set(key, null);
      } else if (!byName.has(key)) {
        byName.set(key, exercise);
      }
    }
  }

  const totals = new Map<MovementPattern | null, PlanPatternSummary>();
  for (const planned of plannedExercises) {
    const name = normalizeName(planned.exercise_name);
    const sets = Number(planned.target_sets);
    if (!name || !Number.isInteger(sets) || sets <= 0) continue;
    const match = byName.get(name);
    const pattern = match?.movement_pattern ?? null;
    const summary = totals.get(pattern) ?? {
      movement_pattern: pattern,
      exercise_count: 0,
      target_sets: 0,
    };
    summary.exercise_count += 1;
    summary.target_sets += sets;
    totals.set(pattern, summary);
  }

  return [...totals.values()].sort((left, right) => {
    if (left.movement_pattern === null) return 1;
    if (right.movement_pattern === null) return -1;
    return MOVEMENT_PATTERNS.indexOf(left.movement_pattern) - MOVEMENT_PATTERNS.indexOf(right.movement_pattern);
  });
}
