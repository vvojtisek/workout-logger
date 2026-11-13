import { useMemo, useState } from "react";

import type { WorkoutLog } from "@/api/types";
import { liftNames, weeklyVolume } from "@/lib/dashboard-stats";
import { formatTonnage } from "@/lib/log-metrics";

const WEEKS = 12;
const W = 480;
const H = 150;
const PAD = { top: 18, right: 4, bottom: 22, left: 4 };

type Metric = "volumeKg" | "sets";

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(day)}/${Number(month)}`;
}

/** Weekly training volume over the last 12 weeks, for everything or one lift.
 * Plain SVG: nothing to load, themed by the same tokens as the rest. */
export function VolumeChart({ logs }: { logs: WorkoutLog[] }) {
  const [metric, setMetric] = useState<Metric>("volumeKg");
  const [lift, setLift] = useState("");
  const lifts = useMemo(() => liftNames(logs), [logs]);
  const weeks = useMemo(
    () => weeklyVolume(logs, { weeks: WEEKS, lift: lift || undefined }),
    [logs, lift],
  );

  const values = weeks.map((week) => week[metric]);
  const max = Math.max(...values, 1);
  const slot = (W - PAD.left - PAD.right) / weeks.length;
  const barWidth = slot * 0.62;
  const plotHeight = H - PAD.top - PAD.bottom;
  const format = (value: number) =>
    metric === "volumeKg" ? formatTonnage(value) : `${value} sets`;
  const last = values.at(-1) ?? 0;
  const previous = values.at(-2) ?? 0;
  const label = `${metric === "volumeKg" ? "Weekly tonnage" : "Weekly sets"}${lift ? ` for ${lift}` : ""}, last ${WEEKS} weeks. This week ${format(last)}; last week ${format(previous)}.`;

  return (
    <section aria-labelledby="volume-heading">
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <h3 id="volume-heading" className="mr-auto text-sm font-semibold text-muted">
          Volume progression
        </h3>
        <div role="group" aria-label="Metric" className="flex gap-1">
          {(
            [
              ["volumeKg", "Tonnage"],
              ["sets", "Sets"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={metric === value}
              onClick={() => setMetric(value)}
              className={`min-h-11 rounded-full border px-4 text-sm ${
                metric === value
                  ? "border-accent bg-accent-soft text-main"
                  : "border-line bg-elevated text-muted"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
        <select
          aria-label="Lift"
          className="input min-h-11 w-auto max-w-48"
          value={lift}
          onChange={(event) => setLift(event.target.value)}
        >
          <option value="">All lifts</option>
          {lifts.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        data-testid="volume-chart"
      >
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          stroke="var(--border-subtle)"
        />
        {weeks.map((week, index) => {
          const value = week[metric];
          const height = (value / max) * plotHeight;
          const x = PAD.left + index * slot + (slot - barWidth) / 2;
          const y = H - PAD.bottom - height;
          const current = index === weeks.length - 1;
          return (
            <g key={week.weekStart} data-week={week.weekStart} data-value={value}>
              <rect
                x={x}
                y={value > 0 ? y : H - PAD.bottom - 1}
                width={barWidth}
                height={value > 0 ? height : 1}
                rx={2}
                fill={current ? "var(--accent-primary)" : "var(--text-dim)"}
              />
              {value === max && value > 0 ? (
                <text
                  // Near the right edge, grow leftward so the label stays inside.
                  x={index >= weeks.length - 2 ? x + barWidth : x + barWidth / 2}
                  y={y - 5}
                  textAnchor={index >= weeks.length - 2 ? "end" : "middle"}
                  fontSize="10"
                  fill="var(--text-muted)"
                  fontFamily="var(--font-mono)"
                >
                  {metric === "volumeKg" ? formatTonnage(value) : value}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={PAD.left} y={H - 6} fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-mono)">
          {shortDate(weeks[0].weekStart)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
          fontSize="10"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
        >
          this week
        </text>
      </svg>
    </section>
  );
}
