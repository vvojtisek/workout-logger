import type { ExerciseLog } from "@/api/types";

export interface LogMetrics {
  sets: number;
  /** Sum of reps x load over loaded exercises, in kg. */
  volumeKg: number;
  /** The heaviest set and the most reps managed at that weight. */
  best: { name: string; weightKg: number; reps: number } | null;
}

/** Sets, volume and best set of one logged workout. A log carries one load per
 * exercise, so volume is that load times every rep of every set. */
export function logMetrics(log: { exercises?: ExerciseLog[] }): LogMetrics {
  let sets = 0;
  let volumeKg = 0;
  let best: LogMetrics["best"] = null;
  for (const exercise of log.exercises ?? []) {
    sets += exercise.reps_per_set.length;
    const weight = exercise.weight_kg;
    if (!weight) continue;
    volumeKg += weight * exercise.reps_per_set.reduce((total, reps) => total + reps, 0);
    const reps = Math.max(...exercise.reps_per_set);
    if (!best || weight > best.weightKg) {
      best = { name: exercise.exercise_name, weightKg: weight, reps };
    }
  }
  return { sets, volumeKg, best };
}

/** 6420 -> "6,420 kg". */
export function formatTonnage(volumeKg: number): string {
  return `${Math.round(volumeKg).toLocaleString("en-US")} kg`;
}

export interface LogFilter {
  /** Only logs from the last N days; null for all time. */
  days: number | null;
  /** Only logs from this plan; empty for any. */
  plan: string;
}

const DAY_MS = 86_400_000;

export function filterLogs<T extends { performed_at: string; source_plan_name: string | null }>(
  logs: T[],
  filter: LogFilter,
  now: Date = new Date(),
): T[] {
  const since = filter.days === null ? null : now.getTime() - filter.days * DAY_MS;
  return logs.filter(
    (log) =>
      (since === null || new Date(log.performed_at).getTime() >= since) &&
      (filter.plan === "" || log.source_plan_name === filter.plan),
  );
}

/** The distinct plan names present in the logs, for the plan filter. */
export function planNames(logs: { source_plan_name: string | null }[]): string[] {
  return [...new Set(logs.map((log) => log.source_plan_name).filter((name): name is string => Boolean(name)))].sort();
}
