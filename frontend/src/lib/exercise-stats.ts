import type { ExerciseStats } from "@/api/types";

const TREND_LABELS = { up: "load up", down: "load down", flat: "load steady" } as const;

function formatKg(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} kg`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Short facts shown under an exercise heading during a workout: last session,
 * heaviest set, estimated 1RM and load trend. Empty when nothing is logged yet. */
export function exerciseStatsFacts(stats: ExerciseStats | undefined): string[] {
  if (!stats || stats.sessions_count === 0) return [];
  const facts: string[] = [];
  if (stats.last_performed_at && stats.last_reps_per_set) {
    const reps = stats.last_reps_per_set.join("/");
    const load = stats.last_weight_kg ? `${formatKg(stats.last_weight_kg)} × ${reps}` : `${reps} reps`;
    facts.push(`Last ${formatDate(stats.last_performed_at)}: ${load}`);
  }
  if (stats.best_weight_kg !== null && stats.best_weight_reps !== null) {
    facts.push(`Best ${formatKg(stats.best_weight_kg)} × ${stats.best_weight_reps}`);
  }
  if (stats.estimated_one_rep_max_kg !== null) {
    facts.push(`e1RM ${formatKg(stats.estimated_one_rep_max_kg)}`);
  }
  if (stats.trend) facts.push(TREND_LABELS[stats.trend]);
  return facts;
}
