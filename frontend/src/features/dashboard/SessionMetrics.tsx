import type { WorkoutLog } from "@/api/types";
import { formatTonnage, logMetrics } from "@/lib/log-metrics";

/** "12 sets · 6,420 kg · Best 92.5 kg × 5": what a lifting session amounted
 * to, readable without opening it. Nothing for an activity or empty log. */
export function SessionMetrics({ log }: { log: Pick<WorkoutLog, "exercises"> }) {
  const { sets, volumeKg, best } = logMetrics(log);
  if (sets === 0) return null;
  const parts = [`${sets} sets`];
  if (volumeKg > 0) parts.push(formatTonnage(volumeKg));
  if (best) parts.push(`Best ${best.weightKg} kg × ${best.reps}`);
  return (
    <span data-numeric data-testid="session-metrics">
      {parts.join(" · ")}
    </span>
  );
}
