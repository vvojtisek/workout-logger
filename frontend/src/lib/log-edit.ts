// Editing a saved workout log: the stored record as form values, and the
// form values back as a PATCH body. Fields the form does not show (including
// ones added to exercise logs later) are carried through untouched.
import type { ExerciseLog, WorkoutLog } from "@/api/types";
import { localDateTimeInputToIso, toLocalDateTimeInput } from "./date-time-inputs";

export interface SetDraft {
  key: string;
  weight: string;
  reps: string;
  rir: string;
}

export interface ExerciseDraft {
  key: string;
  exercise_name: string;
  sets: SetDraft[];
  /** The stored exercise, or null for one added in the editor. */
  original: ExerciseLog | null;
}

export interface LogDraft {
  performedAt: string;
  totalTime: string;
  feeling: string;
  notes: string;
  exercises: ExerciseDraft[];
}

export type LogPatch = Record<string, unknown>;

const READ_ONLY_EXERCISE_FIELDS = ["id", "sort_order"] as const;

function text(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

function emptySet(): SetDraft {
  return { key: crypto.randomUUID(), weight: "", reps: "", rir: "" };
}

export function logToDraft(log: WorkoutLog): LogDraft {
  return {
    performedAt: toLocalDateTimeInput(log.performed_at),
    totalTime: String(log.total_time_minutes),
    feeling: String(log.overall_feeling),
    notes: log.notes ?? "",
    exercises: log.exercises.map((exercise) => ({
      key: exercise.id,
      exercise_name: exercise.exercise_name,
      original: exercise,
      sets: exercise.reps_per_set.map((reps, index) => ({
        key: crypto.randomUUID(),
        weight: text(exercise.weight_per_set ? exercise.weight_per_set[index] : exercise.weight_kg),
        reps: String(reps),
        rir: text(exercise.rir_per_set?.[index]),
      })),
    })),
  };
}

export function newExercise(): ExerciseDraft {
  return { key: crypto.randomUUID(), exercise_name: "", sets: [emptySet()], original: null };
}

/** Appends a copy of the last set (weight and reps), so repeating a set is one tap. */
export function addSet(exercise: ExerciseDraft): ExerciseDraft {
  const last = exercise.sets.at(-1);
  const next = last ? { ...last, key: crypto.randomUUID(), rir: "" } : emptySet();
  return { ...exercise, sets: [...exercise.sets, next] };
}

export function removeSet(exercise: ExerciseDraft, setKey: string): ExerciseDraft {
  return { ...exercise, sets: exercise.sets.filter((set) => set.key !== setKey) };
}

function optionalNumber(raw: string, valid: (value: number) => boolean): number | null | undefined {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && valid(value) ? value : undefined;
}

function exercisePayload(exercise: ExerciseDraft): Record<string, unknown> | string {
  const name = exercise.exercise_name.trim();
  if (!name) return "Every exercise needs a name.";
  if (exercise.sets.length === 0) return `${name} has no sets. Add a set or remove the exercise.`;

  const reps: number[] = [];
  const weights: (number | null)[] = [];
  const rirs: (number | null)[] = [];
  for (const [index, set] of exercise.sets.entries()) {
    const label = `${name} set ${index + 1}`;
    const rep = Number(set.reps);
    if (!Number.isInteger(rep) || rep < 1 || rep > 1000) return `${label}: reps must be 1 or more.`;
    const weight = optionalNumber(set.weight, (value) => value >= 0);
    if (weight === undefined) return `${label}: weight must be 0 kg or more.`;
    const rir = optionalNumber(set.rir, (value) => Number.isInteger(value) && value >= 0 && value <= 10);
    if (rir === undefined) return `${label}: RIR must be a whole number from 0 to 10.`;
    reps.push(rep);
    weights.push(weight);
    rirs.push(rir);
  }

  const kept: Record<string, unknown> = { rest_time_seconds: 60, notes: null };
  if (exercise.original) {
    Object.assign(kept, exercise.original);
    for (const field of READ_ONLY_EXERCISE_FIELDS) delete kept[field];
  }
  const loaded = weights.filter((weight): weight is number => weight != null);
  return {
    ...kept,
    exercise_name: name,
    sets_count: reps.length,
    reps_per_set: reps,
    weight_kg: loaded.at(-1) ?? null,
    weight_per_set: weights,
    rir_per_set: rirs,
  };
}

/** The PATCH body for the edited log, or the first problem to show the user. */
export function draftToPatch(
  draft: LogDraft
): { patch: LogPatch; error: null } | { patch: null; error: string } {
  const performedAt = localDateTimeInputToIso(draft.performedAt.trim());
  if (!performedAt) {
    return { patch: null, error: "Enter a valid date and time as YYYY-MM-DD HH:mm." };
  }
  const minutes = Number(draft.totalTime);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    return { patch: null, error: "Duration must be 1 to 1440 minutes." };
  }
  const exercises = [];
  for (const exercise of draft.exercises) {
    const payload = exercisePayload(exercise);
    if (typeof payload === "string") return { patch: null, error: payload };
    exercises.push(payload);
  }
  return {
    patch: {
      performed_at: performedAt,
      total_time_minutes: minutes,
      overall_feeling: Number(draft.feeling),
      notes: draft.notes.trim() || null,
      exercises,
    },
    error: null,
  };
}

/** "60 kg × 8, 62.5 kg × 6" when sets differ; the older "8, 6 reps @ 62.5kg" otherwise. */
export function exerciseSetsText(exercise: ExerciseLog): string {
  const weights = exercise.weight_per_set;
  if (weights && new Set(weights).size > 1) {
    return exercise.reps_per_set
      .map((reps, index) => (weights[index] == null ? `${reps}` : `${weights[index]} kg × ${reps}`))
      .join(", ");
  }
  const weight = weights ? weights[0] : exercise.weight_kg;
  return `${exercise.reps_per_set.join(", ")} reps${weight ? ` @ ${weight}kg` : ""}`;
}
