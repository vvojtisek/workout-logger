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
