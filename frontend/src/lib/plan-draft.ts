import type { Laterality, WorkoutPlan } from "@/api/types";
import type { ExerciseKind } from "@/lib/workout-utils";

/** One exercise row in the plan editor. Fields stay strings while typing. */
export interface ExerciseRowState {
  key: string;
  exercise_name: string;
  exercise_kind: ExerciseKind;
  target_sets: string;
  target_reps_min: string;
  target_reps_max: string;
  target_weight_kg: string;
  rest_time_seconds: string;
  target_rir: string;
  laterality: Laterality;
  notes: string;
  group_key: string;
}

export function emptyRow(restSeconds = 60): ExerciseRowState {
  return {
    key: crypto.randomUUID(),
    exercise_name: "",
    exercise_kind: "strength",
    target_sets: "3",
    target_reps_min: "8",
    target_reps_max: "12",
    target_weight_kg: "",
    rest_time_seconds: String(restSeconds),
    target_rir: "",
    laterality: "bilateral",
    notes: "",
    group_key: "",
  };
}

export function rowFromExercise(exercise: WorkoutPlan["exercises"][number]): ExerciseRowState {
  return {
    key: exercise.id,
    exercise_name: exercise.exercise_name,
    exercise_kind: exercise.exercise_kind,
    target_sets: String(exercise.target_sets),
    target_reps_min: String(exercise.target_reps_min),
    target_reps_max: String(exercise.target_reps_max),
    target_weight_kg: exercise.target_weight_kg != null ? String(exercise.target_weight_kg) : "",
    rest_time_seconds: String(exercise.rest_time_seconds),
    target_rir: exercise.target_rir != null ? String(exercise.target_rir) : "",
    laterality: exercise.laterality ?? "bilateral",
    notes: exercise.notes ?? "",
    group_key: exercise.group_key ?? "",
  };
}

export function buildPayload(name: string, description: string, rows: ExerciseRowState[]) {
  const groupCounters = new Map<string, number>();
  const exercises = rows.map((row) => {
    const groupKey = row.group_key.trim() || null;
    let groupOrder: number | null = null;
    if (groupKey) {
      const count = groupCounters.get(groupKey) ?? 0;
      groupOrder = count;
      groupCounters.set(groupKey, count + 1);
    }
    return {
      exercise_name: row.exercise_name.trim(),
      exercise_kind: row.exercise_kind,
      target_sets: Number.parseInt(row.target_sets, 10),
      target_reps_min: Number.parseInt(row.target_reps_min, 10),
      target_reps_max: Number.parseInt(row.target_reps_max, 10),
      target_weight_kg: row.target_weight_kg.trim()
        ? Number.parseFloat(row.target_weight_kg)
        : null,
      rest_time_seconds: row.rest_time_seconds.trim()
        ? Number.parseInt(row.rest_time_seconds, 10)
        : 60,
      target_rir: row.target_rir.trim() ? Number.parseInt(row.target_rir, 10) : null,
      laterality: row.laterality,
      notes: row.notes.trim() || null,
      group_key: groupKey,
      group_order: groupOrder,
    };
  });
  return { name: name.trim(), description: description.trim() || null, exercises };
}

/** Totals shown above the table; unparsable set counts count as zero. */
export function planSummary(rows: ExerciseRowState[]): { exercises: number; sets: number } {
  let sets = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.target_sets, 10);
    if (Number.isFinite(n)) sets += n;
  }
  return { exercises: rows.length, sets };
}

const LATERALITY_LABELS: Record<Laterality, string> = {
  bilateral: "Both",
  per_side: "Each side",
  single_limb: "One limb",
};

export function lateralityLabel(laterality: Laterality): string {
  return LATERALITY_LABELS[laterality];
}

/** "A", "B"… for superset groups in order of first appearance; "" for no group. */
export function supersetLabels(rows: ExerciseRowState[]): string[] {
  const letters = new Map<string, string>();
  return rows.map((row) => {
    const key = row.group_key.trim();
    if (!key) return "";
    if (!letters.has(key)) letters.set(key, String.fromCharCode(65 + letters.size));
    return letters.get(key) ?? "";
  });
}
