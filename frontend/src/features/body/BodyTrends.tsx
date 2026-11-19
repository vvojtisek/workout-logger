import { useState } from "react";

import { errorMessage } from "@/api/client";
import type { BodyMetric, SleepEntry } from "@/api/types";
import { TrendChart, TrendRangeSelect } from "@/features/trends/TrendChart";
import { entryRange, rangeStart } from "@/features/trends/series";
import type { TrendRange } from "@/features/trends/series";
import { formatDate } from "@/lib/format";
import { localIsoDate } from "@/lib/today";
import { PageHeading } from "@/ui";
import { useBodyEntries, useSleepEntries } from "./entries";

const BODY_METRICS = [
  { key: "weight_kg", label: "Weight", unit: "kg" },
  { key: "body_fat_percent", label: "Body fat", unit: "%" },
  { key: "neck_cm", label: "Neck", unit: "cm" },
  { key: "chest_cm", label: "Chest", unit: "cm" },
  { key: "waist_cm", label: "Waist", unit: "cm" },
  { key: "hips_cm", label: "Hips", unit: "cm" },
  { key: "biceps_cm", label: "Biceps", unit: "cm" },
  { key: "forearms_cm", label: "Forearms", unit: "cm" },
  { key: "thighs_cm", label: "Thighs", unit: "cm" },
  { key: "calves_cm", label: "Calves", unit: "cm" },
] as const satisfies ReadonlyArray<{ key: keyof BodyMetric; label: string; unit: string }>;

function clockMinutes(value: string, timeZone: string): number {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
  const [hour, minute] = clock.split(":").map(Number);
  const total = hour * 60 + minute;
  // Keep 23:00 and 01:00 adjacent so averages across midnight stay meaningful.
  return total < 720 ? total + 1440 : total;
}

function formatClock(value: number): string {
  const minute = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

interface SleepStatistic {
  key: string;
  label: string;
  unit: string;
  value: (entry: SleepEntry) => number | null;
  format?: (value: number) => string;
}

const SLEEP_METRICS: SleepStatistic[] = [
  { key: "time_in_bed_seconds", label: "Time in bed", unit: "h", value: (entry) => entry.time_in_bed_seconds / 3600 },
  { key: "estimated_sleep_seconds", label: "Estimated sleep", unit: "h", value: (entry) => entry.estimated_sleep_seconds == null ? null : entry.estimated_sleep_seconds / 3600 },
  { key: "awake_seconds", label: "Time awake", unit: "min", value: (entry) => entry.awake_seconds == null ? null : entry.awake_seconds / 60 },
  { key: "quality_score", label: "Sleep quality", unit: "out of 5", value: (entry) => entry.quality_score },
  { key: "resting_heart_rate", label: "Resting heart rate", unit: "bpm", value: (entry) => entry.resting_heart_rate },
  { key: "sleep_start", label: "Bedtime", unit: "", value: (entry) => clockMinutes(entry.sleep_start, entry.timezone), format: formatClock },
  { key: "sleep_end", label: "Wake time", unit: "", value: (entry) => clockMinutes(entry.sleep_end, entry.timezone), format: formatClock },
];

type Category = "body" | "sleep";

function StatisticSelect({ metrics, value, onChange }: {
  metrics: readonly { key: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Statistic
      <select className="input min-h-11 w-auto" value={value} onChange={(event) => onChange(event.target.value)}>
        {metrics.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
  );
}

export function BodyTrend({ rows, metricKey = "weight_kg", range, end }: {
  rows: BodyMetric[];
  metricKey?: string;
  range: TrendRange;
  end: string;
}) {
  const metric = BODY_METRICS.find(({ key }) => key === metricKey) ?? BODY_METRICS[0];
  return (
    <TrendChart title={metric.label} unit={metric.unit}
      points={rows.map((entry) => ({ date: formatDate(entry.measured_at), value: entry[metric.key] }))}
      range={range} end={end} aggregation="average"
      entries={(from, to) => entryRange("/biometrics", from, to)}
    />
  );
}

export function SleepTrend({ rows, metricKey = "time_in_bed_seconds", range, end }: {
  rows: SleepEntry[];
  metricKey?: string;
  range: TrendRange;
  end: string;
}) {
  const metric = SLEEP_METRICS.find(({ key }) => key === metricKey) ?? SLEEP_METRICS[0];
  return (
    <TrendChart title={metric.label} unit={metric.unit}
      points={rows.map((entry) => ({ date: entry.sleep_date, value: metric.value(entry) }))}
      range={range} end={end} aggregation="average" format={metric.format}
      entries={(from, to) => entryRange("/sleep", from, to)}
    />
  );
}

function BodyTrendSelection({ range, end }: { range: TrendRange; end: string }) {
  const [key, setKey] = useState<string>(BODY_METRICS[0].key);
  const query = useBodyEntries(rangeStart(range, end), end);
  return (
    <>
      <StatisticSelect metrics={BODY_METRICS} value={key} onChange={setKey} />
      {query.isPending ? <p role="status" className="mt-4 text-sm text-muted">Loading measurements…</p> : null}
      {query.error ? <p role="alert" className="mt-4 text-sm text-danger">{errorMessage(query.error)}</p> : null}
      {query.data ? <BodyTrend rows={query.data} metricKey={key} range={range} end={end} /> : null}
    </>
  );
}

function SleepTrendSelection({ range, end }: { range: TrendRange; end: string }) {
  const [key, setKey] = useState(SLEEP_METRICS[0].key);
  const query = useSleepEntries(rangeStart(range, end), end);
  return (
    <>
      <StatisticSelect metrics={SLEEP_METRICS} value={key} onChange={setKey} />
      {query.isPending ? <p role="status" className="mt-4 text-sm text-muted">Loading sleep data…</p> : null}
      {query.error ? <p role="alert" className="mt-4 text-sm text-danger">{errorMessage(query.error)}</p> : null}
      {query.data ? <SleepTrend rows={query.data} metricKey={key} range={range} end={end} /> : null}
    </>
  );
}

export function BodyTrends() {
  const [category, setCategory] = useState<Category>("body");
  const [range, setRange] = useState<TrendRange>("30");
  const today = localIsoDate(new Date());
  return (
    <section>
      <PageHeading>Body &amp; sleep trends</PageHeading>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <TrendRangeSelect value={range} onChange={setRange} />
        <label className="flex items-center gap-2 text-sm text-muted">
          Category
          <select className="input min-h-11 w-auto" value={category} onChange={(event) => setCategory(event.target.value as Category)}>
            <option value="body">Measurements</option>
            <option value="sleep">Sleep</option>
          </select>
        </label>
      </div>
      {category === "body" ? <BodyTrendSelection range={range} end={today} /> : <SleepTrendSelection range={range} end={today} />}
    </section>
  );
}
