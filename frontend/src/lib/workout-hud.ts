import {
  buildGroupRounds,
  buildWorkoutGrid,
  groupSessionExercises,
} from "./workout-utils";
import type { GridRow, GridSession } from "./workout-utils";
import type { WorkoutSession } from "@/api/types";
import type { SetOperation } from "./active-workout-state";

/** A set in the order it is performed, with the superset badge it shows. */
export interface HudRow extends GridRow {
  /** "A1", "A2", ... for exercises in a superset, null otherwise. */
  badge: string | null;
}

const GROUP_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Every set of the session in performance order: exercises in plan order,
 * supersets interleaved by round. Matches the server's focus order. */
export function performanceOrder(session: GridSession): HudRow[] {
  const rows = buildWorkoutGrid(session);
  let supersetIndex = 0;
  return groupSessionExercises(session.exercises).flatMap((group): HudRow[] => {
    if (group.exercises.length < 2) {
      return rows
        .filter((row) => row.exercise.id === group.exercises[0].id)
        .map((row) => ({ ...row, badge: null }));
    }
    const letter = GROUP_LETTERS[supersetIndex] ?? "?";
    supersetIndex += 1;
    const position = new Map(
      group.exercises.map((exercise, index) => [exercise.id, index + 1]),
    );
    return buildGroupRounds(rows, group.exercises).map(
      ({ roundLabel: _round, ...row }) => ({
        ...row,
        badge: `${letter}${position.get(row.exercise.id) ?? ""}`,
      }),
    );
  });
}

/** Index of the set the HUD shows: the focused set, else the first set not
 * yet logged, else the last set (so a finished session still shows what was
 * logged last). -1 only for a session without sets. */
export function hudIndex(session: GridSession, rows: HudRow[]): number {
  const focused = rows.findIndex(
    (row) =>
      row.exercise.id === session.focused_exercise_id &&
      row.setNumber === session.focused_set_number,
  );
  if (focused >= 0) return focused;
  const pending = rows.findIndex((row) => row.entry === null);
  if (pending >= 0) return pending;
  return rows.length - 1;
}

export interface QueuedRest {
  operationId: string;
  defaultSeconds: number;
}

/** Applies only locally committed entries the server snapshot has not seen. */
export function projectQueuedSets(
  session: WorkoutSession,
  queue: SetOperation[],
): { session: WorkoutSession; rest: QueuedRest | null } {
  if (queue.length === 0) return { session, rest: null };
  const projected = {
    ...session,
    exercises: session.exercises.map((exercise) => ({ ...exercise, set_entries: [...exercise.set_entries] })),
  };
  let rest: QueuedRest | null = null;
  let restStarted = session.exercises.flatMap((exercise) => exercise.set_entries)
    .reduce((latest, entry) => {
      const time = entry.state === "completed" && entry.completed_at ? Date.parse(entry.completed_at) : NaN;
      return Number.isFinite(time) ? Math.max(latest, time) : latest;
    }, -Infinity);
  const sessionStarted = Date.parse(session.started_at);
  let changed = false;
  for (const operation of queue) {
    const set = operation.payload;
    const exercise = projected.exercises.find((item) => item.id === set.session_exercise_id);
    if (!exercise || set.set_number < 1 || set.set_number > exercise.target_sets ||
        exercise.set_entries.some((entry) => entry.set_number === set.set_number)) continue;

    const state = set.state ?? "completed";
    exercise.set_entries.push({
      id: operation.client_operation_id,
      set_number: set.set_number,
      weight_kg: set.weight_kg,
      reps: set.reps,
      rir: set.rir,
      rpe: set.rpe ?? null,
      added_weight_kg: set.added_weight_kg ?? null,
      band_level: set.band_level ?? null,
      duration_seconds: set.duration_seconds ?? null,
      distance_km: set.distance_km ?? null,
      incline_percent: set.incline_percent ?? null,
      state,
      pending: true,
    });
    changed = true;

    if (state === "completed" && set.client_completed_at) {
      const started = Math.max(sessionStarted, Date.parse(set.client_completed_at));
      if (!Number.isFinite(started) || started < restStarted) continue;
      restStarted = started;
      const seconds = set.client_rest_seconds ?? exercise.rest_time_seconds;
      projected.rest_ends_at = set.client_rest_seconds === 0
        ? null
        : new Date(started + seconds * 1000).toISOString();
      rest = { operationId: operation.client_operation_id, defaultSeconds: exercise.rest_time_seconds };
    }
  }
  if (!changed) return { session, rest: null };

  const rows = performanceOrder(projected);
  const next = rows.find((row) => row.entry === null) ?? rows.at(-1);
  if (next) {
    projected.focused_exercise_id = next.exercise.id;
    projected.focused_set_number = next.setNumber;
  }
  return { session: projected, rest };
}

/** "EXERCISE X OF Y" counts distinct exercises in performance order. */
export function exercisePosition(
  rows: HudRow[],
  index: number,
): { index: number; total: number } {
  const ids: string[] = [];
  for (const row of rows)
    if (!ids.includes(row.exercise.id)) ids.push(row.exercise.id);
  const current = rows[index]?.exercise.id;
  return { index: current ? ids.indexOf(current) + 1 : 0, total: ids.length };
}

export function previousSet(rows: HudRow[], index: number): HudRow | null {
  return index > 0 ? rows[index - 1] : null;
}

/** First set of the next exercise in performance order, preferring one not yet
 * logged. Within a superset this is the partner exercise. */
export function nextExercise(rows: HudRow[], index: number): HudRow | null {
  const current = rows[index];
  if (!current) return null;
  const later = rows
    .slice(index + 1)
    .filter((row) => row.exercise.id !== current.exercise.id);
  if (later.length === 0) return null;
  const target = later[0].exercise.id;
  const ofTarget = later.filter((row) => row.exercise.id === target);
  return ofTarget.find((row) => row.entry === null) ?? ofTarget[0];
}

/** First set of the previous exercise, for a right swipe. */
export function previousExercise(rows: HudRow[], index: number): HudRow | null {
  const current = rows[index];
  if (!current) return null;
  const earlier = rows
    .slice(0, index)
    .filter((row) => row.exercise.id !== current.exercise.id);
  if (earlier.length === 0) return null;
  const target = earlier[earlier.length - 1].exercise.id;
  const ofTarget = rows.filter((row) => row.exercise.id === target);
  return ofTarget.find((row) => row.entry === null) ?? ofTarget[0];
}

/** Adds a stepper increment without float noise, never below the minimum. */
export function stepValue(raw: string, delta: number, min: number): string {
  const current = Number.parseFloat(raw);
  const base = Number.isFinite(current) ? current : 0;
  const next = Math.max(min, Math.round((base + delta) * 100) / 100);
  return String(next);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Rest countdown as MM:SS. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

/** Session chronometer as HH:MM:SS. */
export function formatElapsed(startedAt: string, now: Date): string {
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000),
  );
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

/** The RIR pill values. "4+" stores 4; a higher RIR is typed on desktop. */
export const RIR_PILLS: { value: string; label: string }[] = [
  { value: "0", label: "0" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4+" },
];

/** Which pill a stored RIR selects: anything 4 or above is "4+". */
export function rirPillValue(raw: string): string {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return "";
  return String(Math.min(4, Math.max(0, value)));
}
