import { useEffect, useState } from "react";
import { Link, useMatch, useNavigate, useSearchParams } from "react-router-dom";

import { useListVersion } from "@/app/MasterDetail";
import { errorMessage } from "@/api/client";
import type { WorkoutLog } from "@/api/types";
import { SessionMetrics } from "@/features/dashboard/SessionMetrics";
import { filterLogs, planNames } from "@/lib/log-metrics";
import type { LogFilter } from "@/lib/log-metrics";
import { logSummaryFacts, logTitle } from "@/lib/activity";
import { EmptyState, PageHeading } from "@/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { addTrendDays, fetchAllEntries, readTrendDate } from "@/features/trends/series";

export function HistoryView() {
  const listVersion = useListVersion();
  const navigate = useNavigate();
  const openLogId = useMatch("/history/:logId")?.params.logId;
  const [params] = useSearchParams();
  const from = readTrendDate(params.get("from"));
  const to = readTrendDate(params.get("to"));
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LogFilter>({ days: null, plan: "" });
  const visible = filterLogs(logs, filter);
  const plans = planNames(logs);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (from) {
      query.set("date_from", new Date(`${from}T00:00`).toISOString());
    }
    if (to) {
      query.set("date_to", new Date(`${addTrendDays(to, 1)}T00:00`).toISOString());
    }
    setLoading(true);
    fetchAllEntries<WorkoutLog>(`/logs?${query}`, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setLogs(items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(`Failed to load history: ${errorMessage(err)}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
    // Reload after the detail beside the list closes (see MasterDetail).
  }, [listVersion, from, to]);

  return (
    <section id="history-view">
      <PageHeading>Workout History</PageHeading>
      {from && to ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          {formatDate(from)} – {formatDate(to)}
          <Link className="text-accent-ink underline" to="/history">Clear chart dates</Link>
        </p>
      ) : null}
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
              onClick={() => void navigate(`/history/${log.id}${params.size ? `?${params}` : ""}`)}
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
