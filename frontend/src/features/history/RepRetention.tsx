import type { ExerciseLog } from "@/api/types";
import { repRetentionGroups } from "@/lib/rep-retention";
import type { RetentionGroup } from "@/lib/rep-retention";
import { useState } from "react";

const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const WIDTH = 280;
const HEIGHT = 86;
const X_PAD = 20;
const Y_PAD = 12;

type ChartMeasure = "reps" | "reps_at_failure";

function RepsChart({ group, measure }: { group: RetentionGroup; measure: ChartMeasure }) {
  const { sets, weightKg } = group;
  const plotted = measure === "reps_at_failure"
    ? sets.filter((set) => set.repsAtFailure !== null)
    : sets;
  const first = plotted[0];
  const last = plotted[plotted.length - 1];
  if (!first || !last) return null;
  const valueFor = (set: (typeof sets)[number]) =>
    measure === "reps_at_failure" ? set.repsAtFailure ?? 0 : set.reps;
  const reps = plotted.map(valueFor);
  const low = Math.min(...reps);
  const high = Math.max(...reps);
  const x = (number: number) =>
    X_PAD + ((number - first.number) / (last.number - first.number)) * (WIDTH - 2 * X_PAD);
  const y = (value: number) => high === low
    ? HEIGHT / 2
    : HEIGHT - Y_PAD - ((value - low) / (high - low)) * (HEIGHT - 2 * Y_PAD);

  return (
    <svg
      role="img"
      aria-label={
        measure === "reps_at_failure"
          ? `Estimated reps at failure at ${weightKg} kg`
          : `Rep retention at ${weightKg} kg`
      }
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-24 w-full"
    >
      <line
        x1={X_PAD}
        x2={WIDTH - X_PAD}
        y1={y(first.reps)}
        y2={y(first.reps)}
        className="stroke-muted"
        strokeDasharray="3 3"
      />
      <polyline
        points={plotted.map((set) => `${x(set.number)},${y(valueFor(set))}`).join(" ")}
        className="fill-none stroke-accent"
        strokeWidth="2"
      />
      {plotted.map((set) => (
        <circle key={set.number} cx={x(set.number)} cy={y(valueFor(set))} r="2.5" className="fill-accent" />
      ))}
      <g className="fill-muted text-[9px]" data-numeric>
        <text x="0" y={y(high) + 3}>{high}</text>
        {low < high ? <text x="0" y={y(low) + 3}>{low}</text> : null}
        <text x={X_PAD} y={HEIGHT - 1} textAnchor="middle">#{first.number}</text>
        <text x={WIDTH - X_PAD} y={HEIGHT - 1} textAnchor="middle">#{last.number}</text>
      </g>
    </svg>
  );
}

function RetentionGroupCard({ group }: { group: RetentionGroup }) {
  const [measure, setMeasure] = useState<ChartMeasure>("reps");
  const hasFailureEstimate = group.sets.filter((set) => set.repsAtFailure !== null).length > 1;

  return (
    <div className="rounded-lg bg-elevated p-3">
      <h4 className="font-medium" data-numeric>{group.weightKg} kg</h4>
      {hasFailureEstimate ? (
        <label className="my-2 flex items-center gap-2 text-xs text-muted">
          <span>Chart measure</span>
          <select
            aria-label={`Chart measure for ${group.weightKg} kg`}
            className="input min-h-10 w-fit py-1"
            value={measure}
            onChange={(event) => setMeasure(event.target.value as ChartMeasure)}
          >
            <option value="reps">Recorded reps</option>
            <option value="reps_at_failure">Estimated reps at failure</option>
          </select>
        </label>
      ) : null}
      <RepsChart group={group} measure={measure} />
      <div className="overflow-x-auto">
        <table aria-label={`Sets at ${group.weightKg} kg`} className="w-full text-left text-xs">
        <thead className="text-muted">
          <tr>
            <th scope="col" className="py-1">Set</th>
            <th scope="col" className="py-1">Reps</th>
            <th scope="col" className="py-1">RIR</th>
            <th scope="col" className="py-1">Reps + RIR</th>
            <th scope="col" className="py-1 text-right">Retention</th>
            <th scope="col" className="py-1 text-right">Est. retention</th>
          </tr>
        </thead>
        <tbody>
          {group.sets.map((set) => (
            <tr key={set.number} className="border-t border-line-muted" data-numeric>
              <th scope="row" className="py-1 font-normal">{set.number}</th>
              <td className="py-1">{set.reps}</td>
              <td className="py-1">{set.rir ?? "—"}</td>
              <td className="py-1">{set.repsAtFailure ?? "—"}</td>
              <td className="py-1 text-right">{PERCENT.format(set.percent)}%</td>
              <td className="py-1 text-right">
                {set.failurePercent === null ? "—" : `${PERCENT.format(set.failurePercent)}%`}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

export function RepRetention({ exercise }: { exercise: ExerciseLog }) {
  const groups = repRetentionGroups(exercise);
  if (!groups.length) return null;

  return (
    <details className="mt-3 border-t border-line-muted pt-3">
      <summary className="cursor-pointer font-medium">Rep retention at the same weight</summary>
      <p className="my-2 text-xs text-muted">
        The chart plots recorded reps by set number at each repeated load. When at least two sets
        have RIR, switch to estimated reps at failure (reps + RIR); unrated sets are omitted from
        that curve. Dashed lines mark the first set in the selected measure. These estimates
        distinguish rep dropoff from changes in reported reserve.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((group) => <RetentionGroupCard key={group.weightKg} group={group} />)}
      </div>
    </details>
  );
}
