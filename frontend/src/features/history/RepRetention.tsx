import type { ExerciseLog } from "@/api/types";
import { repRetentionGroups } from "@/lib/rep-retention";
import type { RetentionGroup } from "@/lib/rep-retention";

const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const WIDTH = 280;
const HEIGHT = 86;
const X_PAD = 20;
const Y_PAD = 12;

function RepsChart({ group }: { group: RetentionGroup }) {
  const { sets, weightKg } = group;
  const first = sets[0];
  const last = sets[sets.length - 1];
  const reps = sets.map((set) => set.reps);
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
      aria-label={`Rep retention at ${weightKg} kg`}
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
        points={sets.map((set) => `${x(set.number)},${y(set.reps)}`).join(" ")}
        className="fill-none stroke-accent"
        strokeWidth="2"
      />
      {sets.map((set) => (
        <circle key={set.number} cx={x(set.number)} cy={y(set.reps)} r="2.5" className="fill-accent" />
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

export function RepRetention({ exercise }: { exercise: ExerciseLog }) {
  const groups = repRetentionGroups(exercise);
  if (!groups.length) return null;

  return (
    <details className="mt-3 border-t border-line-muted pt-3">
      <summary className="cursor-pointer font-medium">Rep retention at the same weight</summary>
      <p className="my-2 text-xs text-muted">
        The chart plots reps by set number in workout history. Retention divides those reps by the first
        set's reps at the same recorded weight, marked by the dashed line. Other sets can appear
        between the compared sets.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((group) => (
          <div className="rounded-lg bg-elevated p-3" key={group.weightKg}>
            <h4 className="font-medium" data-numeric>{group.weightKg} kg</h4>
            <RepsChart group={group} />
            <table aria-label={`Sets at ${group.weightKg} kg`} className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-1">Set</th>
                  <th scope="col" className="py-1">Reps</th>
                  <th scope="col" className="py-1">RIR</th>
                  <th scope="col" className="py-1 text-right">Retention</th>
                </tr>
              </thead>
              <tbody>
                {group.sets.map((set) => (
                  <tr key={set.number} className="border-t border-line-muted" data-numeric>
                    <th scope="row" className="py-1 font-normal">{set.number}</th>
                    <td className="py-1">{set.reps}</td>
                    <td className="py-1">{set.rir ?? "—"}</td>
                    <td className="py-1 text-right">{PERCENT.format(set.percent)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </details>
  );
}
