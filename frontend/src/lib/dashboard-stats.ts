import type { CatalogExercise, ExerciseLog, MuscleTag } from "@/api/types";
import { MUSCLE_TAGS } from "@/api/types";

/** The part of a log these aggregations read. */
interface LogLike {
  performed_at: string;
  exercises?: ExerciseLog[];
}

const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of the Monday that starts the week containing `date`. */
function weekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export interface WeekVolume {
  /** The Monday that starts the week, as YYYY-MM-DD. */
  weekStart: string;
  sets: number;
  volumeKg: number;
}

function sameLift(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Sets and tonnage (reps x load) per Monday-based week, oldest first, for the
 * last `weeks` weeks including the current one. Weeks with nothing logged are
 * kept as zero so the chart shows the gap. Optionally follows one lift. */
export function weeklyVolume(
  logs: LogLike[],
  options: { weeks: number; now?: Date; lift?: string },
): WeekVolume[] {
  const now = options.now ?? new Date();
  const current = weekStart(now);
  const buckets: WeekVolume[] = [];
  for (let offset = options.weeks - 1; offset >= 0; offset--) {
    const start = new Date(current);
    start.setDate(start.getDate() - offset * 7);
    buckets.push({ weekStart: isoDate(start), sets: 0, volumeKg: 0 });
  }
  const byWeek = new Map(buckets.map((bucket) => [bucket.weekStart, bucket]));

  for (const log of logs) {
    const bucket = byWeek.get(isoDate(weekStart(new Date(log.performed_at))));
    if (!bucket) continue;
    for (const exercise of log.exercises ?? []) {
      if (options.lift && !sameLift(exercise.exercise_name, options.lift)) continue;
      const reps = exercise.reps_per_set.reduce((total, count) => total + count, 0);
      bucket.sets += exercise.reps_per_set.length;
      bucket.volumeKg += (exercise.weight_kg ?? 0) * reps;
    }
  }
  return buckets;
}

/** Every lift that appears in the logs, once, alphabetical (case-preserving). */
export function liftNames(logs: LogLike[]): string[] {
  const seen = new Map<string, string>();
  for (const log of logs)
    for (const exercise of log.exercises ?? []) {
      const key = exercise.exercise_name.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, exercise.exercise_name.trim());
    }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export interface MuscleRow {
  muscle: MuscleTag;
  /** Direct sets count 1, sets where the muscle assists count 0.5. */
  sets: number;
  /** Nothing trained in the window. */
  under: boolean;
}

export interface MuscleSplit {
  rows: MuscleRow[];
  /** Sets whose exercise is not in the catalogue, so they could not be placed. */
  unmatchedSets: number;
}

/** Sets per muscle group over the last `days` days, busiest first. Muscles
 * with nothing in the window stay in the list, flagged as under-trained, so
 * a neglected one is visible rather than absent. `full_body` is only listed
 * when it was actually trained. */
export function muscleSplit(
  logs: LogLike[],
  catalogue: Pick<CatalogExercise, "name" | "aliases" | "primary_muscles" | "secondary_muscles">[],
  options: { days: number; now?: Date },
): MuscleSplit {
  const now = options.now ?? new Date();
  const since = now.getTime() - options.days * DAY_MS;
  const byName = new Map<string, (typeof catalogue)[number]>();
  for (const entry of catalogue) {
    byName.set(entry.name.trim().toLowerCase(), entry);
    for (const alias of entry.aliases) byName.set(alias.trim().toLowerCase(), entry);
  }

  const totals = new Map<MuscleTag, number>(MUSCLE_TAGS.map((muscle) => [muscle, 0]));
  let unmatchedSets = 0;
  for (const log of logs) {
    const when = new Date(log.performed_at).getTime();
    if (when < since || when > now.getTime() + DAY_MS) continue;
    for (const exercise of log.exercises ?? []) {
      const sets = exercise.reps_per_set.length;
      const entry = byName.get(exercise.exercise_name.trim().toLowerCase());
      if (!entry) {
        unmatchedSets += sets;
        continue;
      }
      for (const muscle of entry.primary_muscles)
        totals.set(muscle, (totals.get(muscle) ?? 0) + sets);
      for (const muscle of entry.secondary_muscles)
        totals.set(muscle, (totals.get(muscle) ?? 0) + sets / 2);
    }
  }

  const rows = [...totals.entries()]
    .filter(([muscle, sets]) => muscle !== "full_body" || sets > 0)
    .map(([muscle, sets]) => ({ muscle, sets, under: sets === 0 }))
    .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));
  return { rows, unmatchedSets };
}
