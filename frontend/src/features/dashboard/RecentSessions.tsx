import { useNavigate } from "react-router-dom";

import type { WorkoutLog } from "@/api/types";
import { logTitle } from "@/lib/activity";
import { formatDateTime } from "@/lib/format";
import { SessionMetrics } from "./SessionMetrics";

/** The latest sessions, each with what it amounted to. A flat list on the
 * page's own surface: no card per row. */
export function RecentSessions({ logs, limit = 8 }: { logs: WorkoutLog[]; limit?: number }) {
  const navigate = useNavigate();
  const recent = logs.slice(0, limit);
  return (
    <section aria-labelledby="recent-sessions-heading">
      <h3 id="recent-sessions-heading" className="pb-2 text-sm font-semibold text-muted">
        Recent sessions
      </h3>
      {recent.length === 0 ? (
        <p className="text-sm text-muted">Nothing logged yet. Finish a workout to see it here.</p>
      ) : (
        <ul className="divide-y divide-line-muted">
          {recent.map((log) => {
            const when = formatDateTime(log.performed_at);
            // A lifting log without a plan is titled by its date; don't say it twice.
            const title = log.source_plan_name ?? logTitle(log);
            return (
            <li key={log.id}>
              <button
                type="button"
                onClick={() => void navigate(`/history/${log.id}`)}
                className="flex min-h-11 w-full flex-col items-start gap-0.5 py-2 text-left hover:bg-elevated"
              >
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{title}</span>
                  {title === when ? null : (
                    <span className="shrink-0 text-xs text-muted" data-numeric>
                      {when}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted">
                  <SessionMetrics log={log} />
                </span>
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
