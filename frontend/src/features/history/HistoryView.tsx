import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Paginated, WorkoutLogSummary } from "@/api/types";
import { EmptyState, PageHeading } from "@/ui";

export function HistoryView() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<WorkoutLogSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<Paginated<WorkoutLogSummary>>("/logs?limit=100")
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
        {logs.map((log) => (
          <li key={log.id}>
            <button
              type="button"
              onClick={() => void navigate(`/history/${log.id}`)}
              className="card w-full p-4 text-left transition-colors hover:bg-surface-sunken"
            >
              <p className="font-medium">
                {log.source_plan_name || new Date(log.performed_at).toLocaleString()}
              </p>
              <p className="mt-0.5 text-sm text-muted" data-numeric>
                Feeling: {log.overall_feeling}/5 · {log.total_time_minutes} min
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
