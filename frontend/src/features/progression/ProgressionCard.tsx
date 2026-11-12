import { useId } from "react";

import type { ExerciseStats, OneRepMaxFormula } from "@/api/types";
import { exerciseStatsFacts, STATS_RANGES } from "@/lib/exercise-stats";
import type { StatsRange } from "@/lib/exercise-stats";
import { formatDate } from "@/lib/format";
import { progressionChart } from "@/lib/workout-desktop";

const ESTIMATE_FORMULAS: Record<OneRepMaxFormula, { label: string; equation: string }> = {
  epley: { label: "Epley", equation: "W × (1 + r / 30)" },
  brzycki: { label: "Brzycki", equation: "W / (1.0278 − 0.0278 × r)" },
  lombardi: { label: "Lombardi", equation: "W × r^0.1" },
  wathen: { label: "Wathen", equation: "W / (0.488 + 0.538 × e^(−0.075 × r))" },
};

const CHART_WIDTH = 300;
const CHART_HEIGHT = 120;

function formatKg(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} kg`;
}

function repCurvePoints(reps: number[], width = 160, height = 36): string {
  const peak = Math.max(...reps, 1);
  return reps
    .map((value, index) => {
      const x = reps.length === 1 ? width / 2 : (index / (reps.length - 1)) * width;
      const y = height - (value / peak) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

export function ProgressionCard({
  stats,
  status,
  formula,
  onFormulaChange,
  range,
  onRangeChange,
  showSummary = false,
}: {
  stats: ExerciseStats | undefined;
  status: "pending" | "error" | "success";
  formula: OneRepMaxFormula;
  onFormulaChange: (formula: OneRepMaxFormula) => void;
  range: StatsRange;
  onRangeChange: (range: StatsRange) => void;
  showSummary?: boolean;
}) {
  const id = useId();
  const facts = showSummary ? exerciseStatsFacts(stats) : [];
  const recent = stats?.recent ?? [];
  const chart = progressionChart(recent, CHART_WIDTH, CHART_HEIGHT);
  const best = [...recent]
    .filter((point) => point.estimated_one_rep_max_kg !== null)
    .sort((a, b) => (b.estimated_one_rep_max_kg ?? 0) - (a.estimated_one_rep_max_kg ?? 0))
    .slice(0, 3);

  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="progression-card">
      <h3 className="font-semibold">Progression</h3>
      {facts.length > 0 ? <p className="text-sm text-muted" data-numeric>{facts.join(" · ")}</p> : null}
      <div>
        <label className="field-label" htmlFor={`${id}-range`}>
          History range
        </label>
        <select
          className="input"
          id={`${id}-range`}
          value={range}
          onChange={(event) => onRangeChange(event.target.value as StatsRange)}
        >
          {STATS_RANGES.map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "All history" : `Last ${value} days`}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor={`${id}-formula`}>
          1RM formula
        </label>
        <select
          className="input"
          id={`${id}-formula`}
          aria-describedby={`${id}-formula-help`}
          value={formula}
          onChange={(event) => onFormulaChange(event.target.value as OneRepMaxFormula)}
        >
          {Object.entries(ESTIMATE_FORMULAS).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-formula-help`} className="text-xs text-muted">
        <span data-numeric>{ESTIMATE_FORMULAS[formula].equation}</span>. W is weight in kg and r is
        logged reps. {formula === "epley" ? "Epley uses all logged rep counts." : "Uses sets of 1–10 reps."}{" "}
        These equations assume reps to failure.
      </p>
      {stats?.rep_retention.length ? (
        <div>
          <h4 className="mb-1 text-sm font-medium">Last session · same-load reps</h4>
          <ul className="flex flex-col gap-2" data-numeric>
            {stats.rep_retention.map((group) => (
              <li key={group.weight_kg} className="grid grid-cols-[1fr_10rem] items-center gap-2">
                <div className="text-sm">
                  <span>{formatKg(group.weight_kg)} · {group.reps_per_set.join(" → ")}</span>
                  <span className="ml-2 text-xs text-muted">{group.retention_percent}% retained</span>
                </div>
                <svg
                  role="img"
                  aria-label={`${formatKg(group.weight_kg)} same-load rep curve: ${group.reps_per_set.join(", ")} reps by set`}
                  viewBox="-2 -2 164 40"
                  className="h-9 w-full"
                >
                  <polyline
                    points={repCurvePoints(group.reps_per_set)}
                    className="fill-none stroke-accent"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">
            Last set reps as a share of the first set at that load; this is a rep drop-off measure, not bar velocity or a failure estimate.
          </p>
        </div>
      ) : null}
      {chart ? (
        <>
          <svg
            role="img"
            aria-label={`Estimated 1RM over the last ${chart.points.length} ${chart.points.length === 1 ? "session" : "sessions"}, ${formatKg(chart.points[0].session.estimated_one_rep_max_kg ?? 0)} to ${formatKg(chart.points[chart.points.length - 1].session.estimated_one_rep_max_kg ?? 0)}`}
            data-testid="progression-chart"
            viewBox={`-6 -6 ${CHART_WIDTH + 12} ${CHART_HEIGHT + 12}`}
            className="h-32 w-full"
          >
            <polyline
              points={chart.points.map((point) => `${point.x},${point.y}`).join(" ")}
              className="fill-none stroke-accent"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {chart.points.map((point) => (
              <circle
                key={point.session.performed_at}
                cx={point.x}
                cy={point.y}
                r={4}
                className="fill-accent"
              />
            ))}
          </svg>
          <p className="text-xs text-muted" data-numeric>
            e1RM {formatKg(chart.min)} – {formatKg(chart.max)}
          </p>
          <div>
            <h4 className="mb-1 text-sm font-medium">Best sets</h4>
            <ul className="flex flex-col gap-1 text-sm" data-numeric>
              {best.map((point) => (
                <li key={point.performed_at} className="flex justify-between gap-2">
                  <span className="text-muted">{formatDate(point.performed_at)}</span>
                  <span>
                    {formatKg(point.weight_kg ?? 0)} × {point.top_reps}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <ProgressionEmptyState status={status} formula={formula} range={range} />
      )}
    </section>
  );
}

function ProgressionEmptyState({
  status,
  formula,
  range,
}: {
  status: "pending" | "error" | "success";
  formula: OneRepMaxFormula;
  range: StatsRange;
}) {
  let message = "No weighted history for this exercise yet.";
  if (status === "pending") message = "Loading progression…";
  else if (status === "error") message = "Progression is unavailable.";
  else if (formula !== "epley") message = "No recent weighted sets with 1–10 reps in this range.";
  else if (range !== "all") message = "No weighted sets in this range.";
  return <p role="status" className="text-sm text-muted">{message}</p>;
}
