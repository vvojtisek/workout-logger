import type { ExerciseSessionPoint } from "@/api/types";
import type { SetDraft } from "./active-workout-state";
import type { HudRow } from "./workout-hud";
import type { ExerciseKind, GridExercise, SetEntry } from "./workout-utils";

/** One line of the desktop exercise list. */
export interface ExerciseSummary {
  exercise: GridExercise;
  badge: string | null;
  logged: number;
  total: number;
  /** done: every set logged or skipped; partial: some; todo: none. */
  status: "done" | "partial" | "todo";
  /** The set selecting this exercise opens: the first not yet logged, else set 1. */
  openRow: HudRow | null;
}

/** The session's exercises in performance order, one summary each. */
export function exerciseSummaries(rows: HudRow[]): ExerciseSummary[] {
  const summaries: ExerciseSummary[] = [];
  for (const row of rows) {
    if (summaries.some((summary) => summary.exercise.id === row.exercise.id)) continue;
    const own = rows
      .filter((other) => other.exercise.id === row.exercise.id)
      .sort((a, b) => a.setNumber - b.setNumber);
    const logged = own.filter((other) => other.entry !== null).length;
    summaries.push({
      exercise: row.exercise,
      badge: row.badge,
      logged,
      total: own.length,
      status: logged === 0 ? "todo" : logged === own.length ? "done" : "partial",
      openRow: own.find((other) => other.entry === null) ?? own[0] ?? null,
    });
  }
  return summaries;
}

/** "4 × 8–12 @ 70 kg", shortened when there is no range or load. */
export function targetText(exercise: {
  target_sets: number;
  target_reps_min: number;
  target_reps_max: number;
  target_weight_kg: number | null;
  exercise_kind: ExerciseKind;
}): string {
  if (exercise.exercise_kind === "cardio") {
    return exercise.target_sets === 1 ? "1 set" : `${exercise.target_sets} sets`;
  }
  const reps =
    exercise.target_reps_min === exercise.target_reps_max
      ? `${exercise.target_reps_min}`
      : `${exercise.target_reps_min}–${exercise.target_reps_max}`;
  const load = exercise.target_weight_kg ? ` @ ${exercise.target_weight_kg} kg` : "";
  return `${exercise.target_sets} × ${reps}${load}`;
}

/** The highest-numbered completed (not skipped) set of an exercise. */
export function lastCompletedEntry(exercise: GridExercise): SetEntry | null {
  const completed = exercise.set_entries.filter((entry) => entry.state === "completed");
  if (completed.length === 0) return null;
  return completed.reduce((best, entry) => (entry.set_number > best.set_number ? entry : best));
}

function text(value: number | string | null): string {
  return value === null ? "" : String(value);
}

/** A draft holding a logged set's values. RIR is left for the athlete to rate
 * again, as on the phone. */
export function copyDraftFrom(entry: SetEntry): SetDraft {
  return {
    weight: text(entry.weight_kg),
    reps: text(entry.reps),
    rir: "",
    added_weight_kg: text(entry.added_weight_kg),
    band_level: text(entry.band_level),
    duration_seconds: text(entry.duration_seconds),
    distance_km: text(entry.distance_km),
    incline_percent: text(entry.incline_percent),
  };
}

export interface ChartPoint {
  x: number;
  y: number;
  session: ExerciseSessionPoint;
}

/** Plots estimated 1RM per session into a width × height box, oldest on the
 * left. Sessions without an estimate (no load) are left out. */
export function progressionChart(
  recent: ExerciseSessionPoint[],
  width: number,
  height: number,
): { points: ChartPoint[]; min: number; max: number } | null {
  const plotted = recent.filter((session) => session.estimated_one_rep_max_kg !== null);
  if (plotted.length === 0) return null;
  const values = plotted.map((session) => session.estimated_one_rep_max_kg as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = plotted.map((session, index) => {
    const value = session.estimated_one_rep_max_kg as number;
    return {
      x: plotted.length === 1 ? width / 2 : (index / (plotted.length - 1)) * width,
      y: max === min ? height / 2 : height - ((value - min) / (max - min)) * height,
      session,
    };
  });
  return { points, min, max };
}
