import { useId } from "react";
import { Link } from "react-router-dom";

import { formatDate } from "@/lib/format";
import { trendBuckets } from "./series";
import type { TrendAggregation, TrendPoint, TrendRange } from "./series";

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function TrendRangeSelect({ value, onChange }: {
  value: TrendRange;
  onChange: (range: TrendRange) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Date range
      <select className="input min-h-11 w-auto" value={value} onChange={(event) => onChange(event.target.value as TrendRange)}>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
        <option value="all">All time</option>
      </select>
    </label>
  );
}

export function TrendChart({
  title, unit, points, range, start, end, aggregation, entries, format = NUMBER.format,
}: {
  title: string;
  unit: string;
  points: readonly TrendPoint[];
  range: TrendRange;
  start?: string;
  end: string;
  aggregation: TrendAggregation;
  entries?: (from: string, to: string) => string;
  format?: (value: number) => string;
}) {
  const heading = useId();
  const buckets = trendBuckets(points, range, end, aggregation, start);
  const observed = buckets.filter((bucket) => bucket.value !== null);
  const samples = observed.reduce((total, bucket) => total + bucket.samples, 0);
  const hasTarget = observed.some((bucket) => bucket.target != null);
  const values = observed.flatMap(({ value, target }) => target == null ? [value ?? 0] : [value ?? 0, target]);
  const bars = aggregation === "sum" && values.every((value) => value >= 0);
  const min = values.reduce((left, right) => Math.min(left, right), bars ? 0 : Infinity);
  const max = values.reduce((left, right) => Math.max(left, right), -Infinity);
  const base = bars ? 0 : min - (max - min || 1) * 0.12;
  const top = max + (max - base || 1) * 0.10;
  const width = 600;
  const height = 144;
  const slot = width / buckets.length;
  const x = (index: number) => (index + 0.5) * slot;
  const y = (value: number) => height - (value - base) * height / (top - base);
  const grouping = range === "7" ? "Daily" : range === "all" ? "Monthly" : "Weekly";
  const valueLabel = unit ? `${title} (${unit})` : title;

  return (
    <section aria-labelledby={heading} className="mt-5 rounded-[var(--radius-md)] border border-line-muted bg-surface px-4 py-4">
      <h3 id={heading} className="font-semibold">{valueLabel}</h3>
      {samples === 0 ? (
        <p className="mt-2 text-sm text-muted">No recorded values in this range.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            {grouping} {aggregation === "max" ? "maximum" : aggregation === "sum" ? "total" : "average"}
            {" · "}{samples} {samples === 1 ? "sample" : "samples"}
            {hasTarget ? " · Dashed line shows target" : ""}
          </p>
          <div className="my-3 flex items-stretch gap-2">
            <div aria-hidden="true" data-numeric className="flex flex-col justify-between text-xs text-muted">
              <span>{format(top)}</span>
              <span>{format(base)}</span>
            </div>
            <svg
              role={entries ? undefined : "img"}
              aria-label={`${valueLabel} by date`}
              viewBox={`0 -5 ${width} ${height + 10}`}
              preserveAspectRatio="none"
              className="h-44 min-w-0 flex-1 overflow-visible"
            >
              {[0, height / 2, height].map((row) => (
                <line key={row} x1="0" x2={width} y1={row} y2={row} stroke="var(--border-subtle)" />
              ))}
              {buckets.map((bucket, index) => {
                if (bucket.value === null) return null;
                const previous = buckets[index - 1];
                const position = y(bucket.value);
                const mark = (
                  <>
                    {bars ? (
                      <rect x={x(index) - slot * 0.31} y={Math.min(position, height - 1)} width={slot * 0.62} height={Math.max(1, height - position)} rx="2" fill="var(--accent-primary)" />
                    ) : (
                      <>
                        {previous?.value != null ? <line x1={x(index - 1)} x2={x(index)} y1={y(previous.value)} y2={position} stroke="var(--accent-primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
                        <circle cx={x(index)} cy={position} r="3" fill="var(--accent-primary)" />
                      </>
                    )}
                    {bucket.target != null ? (
                      <line x1={previous?.target != null ? x(index - 1) : x(index) - slot * 0.31} x2={previous?.target != null ? x(index) : x(index) + slot * 0.31} y1={y(previous?.target ?? bucket.target)} y2={y(bucket.target)} stroke="var(--text-muted)" strokeDasharray="4 3" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    ) : null}
                  </>
                );
                const label = `${formatDate(bucket.date)} · ${format(bucket.value)}${unit ? ` ${unit}` : ""}`;
                return entries ? (
                  <Link key={bucket.date} to={entries(bucket.date, bucket.end)} aria-label={`View entries for ${label}`} className="outline-none [@media(pointer:fine)]:hover:opacity-70 focus-visible:opacity-60">
                    <title>{label}</title>
                    {mark}
                    <rect x={index * slot} y="0" width={slot} height={height} fill="transparent" />
                  </Link>
                ) : <g key={bucket.date}><title>{label}</title>{mark}</g>;
              })}
            </svg>
          </div>
          <div className="flex justify-between text-xs text-muted">
            <time dateTime={buckets[0].date}>{formatDate(buckets[0].date)}</time>
            <time dateTime={end}>{formatDate(end)}</time>
          </div>
          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Chart data</summary>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{valueLabel} by date</caption>
              <thead className="text-muted"><tr><th scope="col">Date</th><th scope="col">Value</th>{hasTarget ? <th scope="col">Target</th> : null}<th scope="col">Samples</th></tr></thead>
              <tbody>
                {observed.map((bucket) => {
                  const label = bucket.date === bucket.end ? formatDate(bucket.date) : `${formatDate(bucket.date)} – ${formatDate(bucket.end)}`;
                  return (
                    <tr key={bucket.date} className="border-t border-line-muted">
                      <th scope="row" className="py-1 font-medium">
                        {entries ? <Link className="text-accent-ink underline" to={entries(bucket.date, bucket.end)}>{label}</Link> : label}
                      </th>
                      <td data-numeric>{format(bucket.value ?? 0)}</td>
                      {hasTarget ? <td data-numeric>{bucket.target == null ? "–" : format(bucket.target)}</td> : null}
                      <td data-numeric>{bucket.samples}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
