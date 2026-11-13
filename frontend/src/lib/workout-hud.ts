import {
  buildGroupRounds,
  buildWorkoutGrid,
  groupSessionExercises,
} from "./workout-utils";
import type { ExerciseKind, GridRow, GridSession, SetEntry } from "./workout-utils";

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

/** 105 -> "105", 62.5 -> "62.5": no trailing zeros, tabular-friendly. */
function plain(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** One logged set as a short, glanceable string: "105×8", "+10×6", "25:00". */
export function setSummary(
  kind: ExerciseKind,
  entry: Partial<SetEntry> & { state: string },
): string {
  if (entry.state === "skipped") return "skipped";
  if (kind === "cardio") {
    const seconds = entry.duration_seconds ?? 0;
    return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  }
  const reps = entry.reps ?? 0;
  const load = kind === "bodyweight" ? entry.added_weight_kg : entry.weight_kg;
  if (!load) return `${reps} reps`;
  return `${kind === "bodyweight" ? "+" : ""}${plain(load)}×${reps}`;
}

export interface TrailItem {
  setNumber: number;
  state: "done" | "skipped" | "current" | "todo";
  /** What was logged; null until the set is done. */
  text: string | null;
}

/** The sets of one exercise as a trail: what was logged, which set is on, and
 * what is still to come. Gives the top of the phone HUD something to read. */
export function setTrail(
  rows: HudRow[],
  exerciseId: string,
  currentSet: number,
): TrailItem[] {
  return rows
    .filter((row) => row.exercise.id === exerciseId)
    .map((row) => {
      if (row.entry) {
        const skipped = row.entry.state === "skipped";
        return {
          setNumber: row.setNumber,
          state: skipped ? "skipped" : "done",
          text: setSummary(row.exercise.exercise_kind, row.entry),
        } as const;
      }
      return {
        setNumber: row.setNumber,
        state: row.setNumber === currentSet ? "current" : "todo",
        text: null,
      } as const;
    });
}

/** "Incline Press · 3 sets · 30 kg × 8" for the next exercise, or null. */
export function upNextText(row: HudRow | null): string | null {
  if (!row) return null;
  const { exercise } = row;
  const sets = `${exercise.target_sets} ${exercise.target_sets === 1 ? "set" : "sets"}`;
  const load =
    exercise.exercise_kind === "strength" && exercise.suggested_weight_kg
      ? ` · ${plain(exercise.suggested_weight_kg)} kg × ${exercise.suggested_reps}`
      : "";
  return `${exercise.exercise_name} · ${sets}${load}`;
}
