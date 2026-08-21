/** @param {string} value */
export function parseRepsPerSet(value) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number.parseInt(part, 10));
}

/**
 * @param {{
 *   savedEntry: {weight_kg: number | null, reps: number, rir: number | null} | null,
 *   suggestedWeightKg: number | null,
 *   suggestedReps: number,
 *   suggestionSource: string
 * }} values
 */
export function resolveSetDisplayState(values) {
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

/** @param {string | null} restEndsAt @param {Date} now */
export function remainingTimeSeconds(restEndsAt, now = new Date()) {
  if (!restEndsAt) return 0;
  return Math.max(0, Math.ceil((new Date(restEndsAt).getTime() - now.getTime()) / 1000));
}

/**
 * @typedef {{
 *   id: string,
 *   set_number: number,
 *   weight_kg: number | null,
 *   reps: number,
 *   rir: number | null,
 *   state: string,
 *   completed_at?: string
 * }} SetEntry
 * @typedef {{
 *   id: string,
 *   sort_order: number,
 *   exercise_name: string,
 *   target_sets: number,
 *   suggested_weight_kg: number | null,
 *   suggested_reps: number,
 *   suggestion_source: string,
 *   group_key: string | null,
 *   group_order: number | null,
 *   set_entries: SetEntry[]
 * }} GridExercise
 * @typedef {{
 *   focused_exercise_id: string | null,
 *   focused_set_number: number,
 *   exercises: GridExercise[]
 * }} GridSession
 */

/** @param {GridSession} session */
export function buildWorkoutGrid(session) {
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

/** @param {GridSession} session */
export function workoutProgress(session) {
  const rows = buildWorkoutGrid(session);
  const done = rows.filter((row) => row.entry !== null).length;
  const total = rows.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** @param {GridExercise[]} exercises */
export function groupSessionExercises(exercises) {
  /** @type {Map<string, {key: string, label: string | null, exercises: GridExercise[]}>} */
  const groups = new Map();
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
