import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { NutritionTarget, NutritionTotals, NutritionTrendDay } from "@/api/types";
import { TrendChart, TrendRangeSelect } from "@/features/trends/TrendChart";
import { entryRange, rangeStart } from "@/features/trends/series";
import type { TrendRange } from "@/features/trends/series";
import { PageHeading } from "@/ui";

const NUTRITION_METRICS = [
  { key: "energy_kcal", target: "energy_target_kcal", label: "Calories", unit: "kcal" },
  { key: "protein_g", target: "protein_target_g", label: "Protein", unit: "g" },
  { key: "carbohydrate_g", target: "carbohydrate_target_g", label: "Carbohydrate", unit: "g" },
  { key: "fat_g", target: "fat_target_g", label: "Fat", unit: "g" },
  { key: "fiber_g", target: "fiber_target_g", label: "Fiber", unit: "g" },
] as const satisfies ReadonlyArray<{
  key: keyof NutritionTotals;
  target: keyof NutritionTarget;
  label: string;
  unit: string;
}>;

type MetricKey = (typeof NUTRITION_METRICS)[number]["key"];

export function useNutritionTrends(range: TrendRange, end: string) {
  const params = new URLSearchParams({ to: end });
  const start = rangeStart(range, end);
  if (start) params.set("from", start);
  return useQuery({
    queryKey: ["nutrition-trends", start, end],
    queryFn: ({ signal }) => apiFetch<NutritionTrendDay[]>(`/nutrition/trends?${params}`, { signal }),
  });
}

export function NutritionTrend({ days, metricKey, range, end }: {
  days: NutritionTrendDay[];
  metricKey: MetricKey;
  range: TrendRange;
  end: string;
}) {
  const metric = NUTRITION_METRICS.find(({ key }) => key === metricKey) ?? NUTRITION_METRICS[0];
  const points = days.map((day) => ({
    date: day.date,
    value: day.totals[metric.key],
    target: day.target?.[metric.target],
  }));
  return (
    <TrendChart
      title={metric.label}
      unit={metric.unit}
      points={points}
      range={range}
      end={end}
      aggregation="average"
      entries={(from, to) => entryRange("/nutrition/meals", from, to)}
    />
  );
}

export function NutritionTrends() {
  const [range, setRange] = useState<TrendRange>("30");
  const [metricKey, setMetricKey] = useState<MetricKey>("energy_kcal");
  const end = new Date().toISOString().slice(0, 10);
  const trend = useNutritionTrends(range, end);
  return (
    <section>
      <PageHeading hint="Intake and the targets in effect on each logged UTC date. Averages use logged days.">
        Nutrition trends
      </PageHeading>
      <div className="flex flex-wrap items-end gap-3">
        <TrendRangeSelect value={range} onChange={setRange} />
        <label className="flex items-center gap-2 text-sm text-muted">
          Statistic
          <select className="input min-h-11 w-auto" value={metricKey} onChange={(event) => setMetricKey(event.target.value as MetricKey)}>
            {NUTRITION_METRICS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      {trend.isPending ? <p role="status" className="mt-4 text-sm text-muted">Loading nutrition data…</p> : null}
      {trend.error ? <p role="alert" className="mt-4 text-sm text-danger">{errorMessage(trend.error)}</p> : null}
      {trend.data ? <NutritionTrend days={trend.data} metricKey={metricKey} range={range} end={end} /> : null}
    </section>
  );
}
