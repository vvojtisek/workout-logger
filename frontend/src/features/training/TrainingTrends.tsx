import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { errorMessage } from "@/api/client";
import type { ExerciseLog, WorkoutLog } from "@/api/types";
import { MuscleSplit } from "@/features/dashboard/MuscleSplit";
import { TrendChart, TrendRangeSelect } from "@/features/trends/TrendChart";
import { addTrendDays, entryRange, fetchAllEntries, rangeStart } from "@/features/trends/series";
import type { TrendAggregation, TrendRange } from "@/features/trends/series";
import { liftNames } from "@/lib/dashboard-stats";
import { logMetrics } from "@/lib/log-metrics";
import { localIsoDate } from "@/lib/today";
import { PageHeading } from "@/ui";

interface TrainingMetric<T> {
  label: string;
  unit: string;
  aggregation: TrendAggregation;
  value: (row: T) => number | null;
}

const SESSION_METRICS: TrainingMetric<WorkoutLog>[] = [
  { label: "Sessions", unit: "", aggregation: "sum", value: () => 1 },
  { label: "Duration", unit: "min", aggregation: "sum", value: (log) => log.total_time_minutes },
  { label: "Sets", unit: "", aggregation: "sum", value: (log) => logMetrics(log).sets },
  { label: "Volume", unit: "kg", aggregation: "sum", value: (log) => log.total_volume_kg ?? logMetrics(log).volumeKg },
  { label: "Distance", unit: "km", aggregation: "sum", value: (log) => log.distance_km },
  { label: "Calories burned", unit: "kcal", aggregation: "sum", value: (log) => log.calories_burned },
  { label: "Session effort", unit: "RPE", aggregation: "average", value: (log) => log.effort_rpe },
  { label: "Session load", unit: "AU", aggregation: "sum", value: (log) => log.effort_rpe == null ? null : log.effort_rpe * log.total_time_minutes },
  { label: "Overall feeling", unit: "", aggregation: "average", value: (log) => log.overall_feeling },
  { label: "Swim laps", unit: "", aggregation: "sum", value: (log) => log.laps ?? null },
  { label: "Recovery cycles", unit: "", aggregation: "sum", value: (log) => log.cycles ?? log.sauna_rounds ?? null },
  { label: "Time per recovery cycle", unit: "min", aggregation: "average", value: (log) => log.cycle_minutes ?? null },
  { label: "Feeling before", unit: "", aggregation: "average", value: (log) => log.feel_before ?? null },
  { label: "Feeling after", unit: "", aggregation: "average", value: (log) => log.feel_after ?? null },
];

function maxRecorded(values: readonly (number | null)[]): number | null {
  const recorded = values.filter((value) => value !== null);
  return recorded.length ? Math.max(...recorded) : null;
}

function averageRecorded(values: readonly (number | null)[]): number | null {
  const recorded = values.filter((value) => value !== null);
  return recorded.length ? recorded.reduce((total, value) => total + value, 0) / recorded.length : null;
}

const EXERCISE_METRICS: TrainingMetric<ExerciseLog>[] = [
  { label: "Heaviest set", unit: "kg", aggregation: "max", value: (log) => maxRecorded(log.weight_per_set ?? [log.weight_kg]) },
  { label: "Reps", unit: "", aggregation: "sum", value: (log) => log.reps_per_set.reduce((sum, reps) => sum + reps, 0) },
  { label: "Sets", unit: "", aggregation: "sum", value: (log) => log.reps_per_set.length },
  { label: "Volume", unit: "kg", aggregation: "sum", value: (log) => log.volume_kg ?? logMetrics({ exercises: [log] }).volumeKg },
  { label: "Reps in reserve", unit: "RIR", aggregation: "average", value: (log) => averageRecorded(log.rir_per_set ?? []) },
  { label: "Set effort", unit: "RPE", aggregation: "average", value: (log) => averageRecorded(log.rpe_per_set ?? []) },
  { label: "Rest time", unit: "s", aggregation: "average", value: (log) => log.rest_time_seconds },
];

export function TrainingTrends() {
  const [range, setRange] = useState<TrendRange>("30");
  const [lift, setLift] = useState("");
  const [metricIndex, setMetricIndex] = useState(0);
  const today = localIsoDate(new Date());
  const from = rangeStart(range, today);
  const query = new URLSearchParams({ date_to: new Date(`${addTrendDays(today, 1)}T00:00`).toISOString() });
  if (from) query.set("date_from", new Date(`${from}T00:00`).toISOString());
  const logs = useQuery({
    queryKey: ["training", "trends", query.toString()],
    queryFn: ({ signal }) => fetchAllEntries<WorkoutLog>(`/logs?${query}`, signal),
  });

  const rows = logs.data ?? [];
  const lifts = liftNames(rows);
  const logDate = (log: WorkoutLog) => localIsoDate(new Date(log.performed_at));
  const sessionMetric = SESSION_METRICS[metricIndex] ?? SESSION_METRICS[0];
  const exerciseMetric = EXERCISE_METRICS[metricIndex] ?? EXERCISE_METRICS[0];
  const points = lift
    ? rows.flatMap((log) => log.exercises
      .filter((exercise) => exercise.exercise_name.trim().toLowerCase() === lift.toLowerCase())
      .map((exercise) => ({ date: logDate(log), value: exerciseMetric.value(exercise) })))
    : rows.map((log) => ({ date: logDate(log), value: sessionMetric.value(log) }));
  const metric = lift ? exerciseMetric : sessionMetric;

  return (
    <section>
      <PageHeading>Training trends</PageHeading>
      <div className="flex flex-wrap items-end gap-3">
        <TrendRangeSelect value={range} onChange={setRange} />
        <label className="flex items-center gap-2 text-sm text-muted">
          Exercise
          <select className="input min-h-11 w-auto max-w-52" value={lift} onChange={(event) => { setLift(event.target.value); setMetricIndex(0); }}>
            <option value="">All sessions</option>
            {lift && !lifts.includes(lift) ? <option>{lift}</option> : null}
            {lifts.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          Statistic
          <select className="input min-h-11 w-auto" value={metricIndex} onChange={(event) => setMetricIndex(Number(event.target.value))}>
            {(lift ? EXERCISE_METRICS : SESSION_METRICS).map(({ label }, index) => <option key={label} value={index}>{label}</option>)}
          </select>
        </label>
      </div>
      {logs.isPending ? <p role="status" className="mt-4 text-sm text-muted">Loading training data…</p> : null}
      {logs.error ? <p role="alert" className="mt-4 text-sm text-danger">{errorMessage(logs.error)}</p> : null}
      {logs.data ? (
        <>
          <TrendChart title={metric.label} unit={metric.unit} points={points} range={range} end={today} aggregation={metric.aggregation} entries={(start, end) => entryRange("/history", start, end)} />
          <div className="mt-6 max-w-3xl"><MuscleSplit logs={rows} /></div>
        </>
      ) : null}
      <Link className="btn btn-secondary mt-4" to="/training-load">View detailed training load</Link>
    </section>
  );
}
