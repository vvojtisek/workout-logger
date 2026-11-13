import { useEffect, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Paginated, WorkoutLog } from "@/api/types";
import { SessionMetrics } from "@/features/dashboard/SessionMetrics";
import { filterLogs, planNames } from "@/lib/log-metrics";
import type { LogFilter } from "@/lib/log-metrics";
import { logSummaryFacts, logTitle } from "@/lib/activity";
import { EmptyState, PageHeading } from "@/ui";
import { formatDateTime } from "@/lib/format";

export function HistoryView() {
  const navigate = useNavigate();
  const openLogId = useMatch("/history/:logId")?.params.logId;
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LogFilter>({ days: null, plan: "" });
  const visible = filterLogs(logs, filter);
  const plans = planNames(logs);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<Paginated<WorkoutLog>>("/logs?limit=100")
      .then((data) => {
        if (cancelled) return;
        setLogs(data.items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(`Failed to load history: ${errorMessage(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="history-view">
      <PageHeading>Workout History</PageHeading>
      {logs.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <select
            aria-label="Date range"
            className="input min-h-11 w-auto"
            value={filter.days ?? ""}
            onChange={(event) =>
              setFilter({ ...filter, days: event.target.value ? Number(event.target.value) : null })
            }
          >
            <option value="">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          {plans.length > 0 ? (
            <select
              aria-label="Plan"
              className="input min-h-11 w-auto"
              value={filter.plan}
              onChange={(event) => setFilter({ ...filter, plan: event.target.value })}
            >
              <option value="">Any plan</option>
              {plans.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
      <ul id="history-list" className="flex flex-col gap-3">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && logs.length === 0 ? (
          <li>
            <EmptyState
              title="No workouts logged yet"
              description="Finish an active workout or save one manually to see it here."
            />
          </li>
        ) : null}
        {!error && !loading && logs.length > 0 && visible.length === 0 ? (
          <li className="text-sm text-muted">No workouts match these filters.</li>
        ) : null}
        {visible.map((log) => (
          <li key={log.id}>
            <button
              type="button"
              onClick={() => void navigate(`/history/${log.id}`)}
              aria-current={log.id === openLogId ? "true" : undefined}
              className={`card w-full p-4 text-left transition-colors hover:bg-elevated ${
                log.id === openLogId ? "border-accent bg-elevated" : ""
              }`}
            >
              <p className="font-medium">{logTitle(log)}</p>
              <p className="mt-0.5 text-sm text-muted" data-numeric>
                {log.activity_type ? `${formatDateTime(log.performed_at)} · ` : ""}
                {logSummaryFacts(log).join(" · ")}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                <SessionMetrics log={log} />
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
