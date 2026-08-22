export type ExerciseKind = "strength" | "bodyweight" | "cardio";

export interface SetEntry {
  id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number;
  rir: number | null;
  added_weight_kg: number | null;
  band_level: string | null;
  duration_seconds: number | null;
  distance_km: number | null;
  incline_percent: number | null;
  rpe: number | null;
  state: string;
  completed_at?: string;
  client_operation_id?: string;
}

export interface GridExercise {
  id: string;
  sort_order: number;
  exercise_name: string;
  exercise_kind: ExerciseKind;
  target_sets: number;
  suggested_weight_kg: number | null;
  suggested_reps: number;
  suggestion_source: string;
  group_key: string | null;
  group_order: number | null;
  set_entries: SetEntry[];
}

export interface GridSession {
  focused_exercise_id: string | null;
  focused_set_number: number;
  exercises: GridExercise[];
}

export interface GridRow {
  exercise: GridExercise;
  setNumber: number;
  entry: SetEntry | null;
  state: string;
}

export interface SetDisplayState {
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  isSaved: boolean;
  label: string;
}

export function parseRepsPerSet(value: string): number[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number.parseInt(part, 10));
}

export function resolveSetDisplayState(values: {
  savedEntry: { weight_kg: number | null; reps: number; rir: number | null } | null;
  suggestedWeightKg: number | null;
  suggestedReps: number;
  suggestionSource: string;
}): SetDisplayState {
  if (values.savedEntry) {
    return {
      weightKg: values.savedEntry.weight_kg,
      reps: values.savedEntry.reps,
      rir: values.savedEntry.rir,
      isSaved: true,
      label: "Saved",
    };
  }
  return {
    weightKg: values.suggestedWeightKg,
    reps: values.suggestedReps,
    rir: null,
    isSaved: false,
    label: `Suggested from ${values.suggestionSource} · not saved`,
  };
}

export function remainingTimeSeconds(restEndsAt: string | null, now: Date = new Date()): number {
  if (!restEndsAt) return 0;
  return Math.max(0, Math.ceil((new Date(restEndsAt).getTime() - now.getTime()) / 1000));
}

export function buildWorkoutGrid(session: GridSession): GridRow[] {
  return session.exercises.flatMap((exercise) =>
    Array.from({ length: exercise.target_sets }, (_, index) => {
      const setNumber = index + 1;
      const entry = exercise.set_entries.find((item) => item.set_number === setNumber) || null;
      let state = entry?.state || "future";
      if (
        !entry &&
        exercise.id === session.focused_exercise_id &&
        setNumber === session.focused_set_number
      ) {
        state = "current";
      }
      return { exercise, setNumber, entry, state };
    })
  );
}

export function workoutProgress(session: GridSession): {
  done: number;
  total: number;
  percent: number;
} {
  const rows = buildWorkoutGrid(session);
  const done = rows.filter((row) => row.entry !== null).length;
  const total = rows.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

export interface ExerciseGroup {
  key: string;
  label: string | null;
  exercises: GridExercise[];
}

export function groupSessionExercises(exercises: GridExercise[]): ExerciseGroup[] {
  const groups = new Map<string, ExerciseGroup>();
  exercises.forEach((exercise) => {
    const key = exercise.group_key || `exercise:${exercise.id}`;
    if (!groups.has(key)) {
      groups.set(key, { key, label: exercise.group_key, exercises: [] });
    }
    groups.get(key)?.exercises.push(exercise);
  });
  return Array.from(groups.values()).map((group) => ({
    ...group,
    exercises: group.exercises.sort(
      (left, right) =>
        (left.group_order ?? left.sort_order) - (right.group_order ?? right.sort_order)
    ),
  }));
}

const ROUND_LETTERS = "ABCDEFGHIJ";

export interface RoundRow extends GridRow {
  /** "1A", "1B", "2A", ... — the round number paired with this exercise's
   *  letter within the group. */
  roundLabel: string;
}

/**
 * Interleaves a superset's rows by round instead of by exercise: set 1 of
 * every exercise, then set 2 of every exercise, and so on. A true superset is
 * performed back-to-back across exercises before repeating - listing one
 * exercise's sets to completion before starting the next is just two
 * ordinary exercises sharing a card, not a superset.
 */
export function buildGroupRounds(rows: GridRow[], groupExercises: GridExercise[]): RoundRow[] {
  const maxSets = Math.max(0, ...groupExercises.map((exercise) => exercise.target_sets));
  const result: RoundRow[] = [];
  for (let round = 1; round <= maxSets; round += 1) {
    groupExercises.forEach((exercise, index) => {
      const row = rows.find(
        (candidate) => candidate.exercise.id === exercise.id && candidate.setNumber === round
      );
      if (row) {
        result.push({ ...row, roundLabel: `${round}${ROUND_LETTERS[index] ?? index}` });
      }
    });
  }
  return result;
}
