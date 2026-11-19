import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Program, ScheduledWorkout, WorkoutLog } from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { VolumeChart } from "@/features/dashboard/VolumeChart";
import { addTrendDays, fetchAllEntries } from "@/features/trends/series";
import { formatDate } from "@/lib/format";
import { localIsoDate } from "@/lib/today";
import { Block, PageHeading } from "@/ui";

export function TrainingView() {
  const { session } = useAppContext();
  const now = new Date();
  const today = localIsoDate(now);
  const week = addTrendDays(today, -((now.getDay() + 6) % 7));
  const from = new Date(`${addTrendDays(week, -11 * 7)}T00:00`).toISOString();
  const to = new Date(`${addTrendDays(today, 1)}T00:00`).toISOString();
  const calendar = useQuery({
    queryKey: ["training", "calendar", today],
    queryFn: ({ signal }) => apiFetch<{ items: ScheduledWorkout[] }>(
      `/calendar?from=${today}&to=${addTrendDays(today, 30)}`,
      { signal },
    ),
  });
  const programs = useQuery({
    queryKey: ["training", "programs"],
    queryFn: ({ signal }) => fetchAllEntries<Program>("/programs", signal),
  });
  const logsQuery = useQuery({
    queryKey: ["training", "preview", from, to],
    queryFn: ({ signal }) => fetchAllEntries<WorkoutLog>(
      `/logs?${new URLSearchParams({ date_from: from, date_to: to })}`,
      signal,
    ),
  });

  const next = calendar.data?.items.find((item) => item.status === "scheduled");
  const program = programs.data?.find((item) =>
    item.status === "active" && item.start_date <= today && (!item.end_date || item.end_date >= today),
  );
  const logs = logsQuery.data ?? [];
  const sessions = logs.filter((log) => localIsoDate(new Date(log.performed_at)) >= week);
  const firstError = calendar.error ?? logsQuery.error ?? programs.error;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeading>Training</PageHeading>
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-primary" to={session ? "/workout" : next?.scheduled_date === today ? "/today" : "/plans"}>
            {session ? "Resume workout" : "Start workout"}
          </Link>
          <Link className="btn btn-secondary" to="/activity/quick">Log cardio</Link>
          <Link className="btn btn-secondary" to="/activity/new">Log activity</Link>
        </div>
      </div>
      {firstError ? <p role="alert" className="text-sm text-danger">{errorMessage(firstError)}</p> : null}
      <Block className="py-4">
        <h3 className="font-semibold">Overview</h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted">Next workout</dt>
            <dd className="font-semibold">{calendar.isPending ? "Loading…" : calendar.isError ? "Unavailable" : next?.workout_plan_name ?? "None scheduled"}</dd>
            {next ? <dd className="text-sm text-muted">{formatDate(next.scheduled_date)}</dd> : null}
          </div>
          <div>
            <dt className="text-sm text-muted">Current program</dt>
            <dd className="font-semibold">{programs.isPending ? "Loading…" : programs.isError ? "Unavailable" : program?.name ?? "No active program"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Sessions this week</dt>
            <dd className="font-semibold" data-numeric>{logsQuery.isPending ? "Loading…" : logsQuery.isError ? "Unavailable" : sessions.length}</dd>
            {logsQuery.data ? <dd className="text-sm text-muted">{sessions.reduce((total, log) => total + log.total_time_minutes, 0)} min logged</dd> : null}
          </div>
        </dl>
      </Block>
      {logsQuery.data ? (
        <div className="max-w-3xl">
          <VolumeChart logs={logs} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link className="btn btn-secondary" to="/training/trends">See training trends</Link>
        <Link className="btn btn-secondary" to="/history">View workout entries</Link>
      </div>
    </section>
  );
}
