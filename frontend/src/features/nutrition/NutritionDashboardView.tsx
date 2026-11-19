import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { NutritionDailySummary } from "@/api/types";
import { Button, Block, PageHeading } from "@/ui";
import { formatDate } from "@/lib/format";

import { addTrendDays } from "@/features/trends/series";
import { NutritionTrend, useNutritionTrends } from "./NutritionTrends";

interface MacroRowProps {
  label: string;
  consumed: number;
  target: number | null;
  unit: string;
}

function MacroRow({ label, consumed, target, unit }: MacroRowProps) {
  const percent = target && target > 0 ? Math.min(100, (consumed / target) * 100) : null;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">
          {consumed.toFixed(0)}
          {target != null ? ` / ${target.toFixed(0)}` : ""} {unit}
        </span>
      </div>
      {percent != null ? (
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-elevated">
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function NutritionDashboardView() {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const trends = useNutritionTrends("7", today);

  const { data, error, isLoading } = useQuery({
    queryKey: ["nutrition-daily", date],
    staleTime: 0,
    queryFn: () => apiFetch<NutritionDailySummary>(`/nutrition/daily?date=${date}`),
  });

  return (
    <section id="nutrition-dashboard-view">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between [&_h2+p]:max-w-prose">
        <PageHeading hint="Daily energy and macro totals against your current target.">
          Nutrition
        </PageHeading>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void navigate("/nutrition/meals/new")}>
            Log meal
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <Button aria-label="Previous day" onClick={() => setDate((d) => addTrendDays(d, -1))}>
          ← Prev
        </Button>
        <h3 className="font-medium">{formatDate(date)}</h3>
        <Button aria-label="Next day" onClick={() => setDate((d) => addTrendDays(d, 1))}>
          Next →
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-danger">Failed to load summary: {errorMessage(error)}</p>
      ) : null}

      {!error && !isLoading && data ? (
        <Block className="flex flex-col gap-4 py-4">
          {data.target ? (
            <p className="text-xs text-muted">Target: {data.target.name}</p>
          ) : (
            <p className="text-xs text-muted">
              No nutrition plan covers this date — showing totals only.
            </p>
          )}
          <MacroRow
            label="Energy"
            consumed={data.totals.energy_kcal}
            target={data.target?.energy_target_kcal ?? null}
            unit="kcal"
          />
          <MacroRow
            label="Protein"
            consumed={data.totals.protein_g}
            target={data.target?.protein_target_g ?? null}
            unit="g"
          />
          <MacroRow
            label="Carbohydrate"
            consumed={data.totals.carbohydrate_g}
            target={data.target?.carbohydrate_target_g ?? null}
            unit="g"
          />
          <MacroRow
            label="Fat"
            consumed={data.totals.fat_g}
            target={data.target?.fat_target_g ?? null}
            unit="g"
          />
          <MacroRow
            label="Fiber"
            consumed={data.totals.fiber_g}
            target={data.target?.fiber_target_g ?? null}
            unit="g"
          />
        </Block>
      ) : null}

      {trends.error ? <p role="alert" className="mt-4 text-sm text-danger">Could not load protein trend: {errorMessage(trends.error)}</p> : null}
      {trends.data ? <NutritionTrend days={trends.data} metricKey="protein_g" range="7" end={today} /> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link className="btn btn-secondary" to="/nutrition/trends">See all nutrition trends</Link>
        <Link className="btn btn-secondary" to="/nutrition/meals">View meal log</Link>
      </div>
    </section>
  );
}
