import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { NutritionDailySummary } from "@/api/types";
import { Button, Card, PageHeading } from "@/ui";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

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
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-raised">
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function NutritionDashboardView() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayIso);

  const { data, error, isLoading } = useQuery({
    queryKey: ["nutrition-daily", date],
    queryFn: () => apiFetch<NutritionDailySummary>(`/nutrition/daily?date=${date}`),
  });

  return (
    <section id="nutrition-dashboard-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Daily energy and macro totals against your current target.">
          Nutrition
        </PageHeading>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void navigate("/nutrition/foods")}>Foods</Button>
          <Button onClick={() => void navigate("/nutrition/plans")}>Plans</Button>
          <Button variant="primary" onClick={() => void navigate("/nutrition/meals/new")}>
            Log meal
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <Button aria-label="Previous day" onClick={() => setDate((d) => addDays(d, -1))}>
          ← Prev
        </Button>
        <h3 className="font-medium">{date}</h3>
        <Button aria-label="Next day" onClick={() => setDate((d) => addDays(d, 1))}>
          Next →
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-danger">Failed to load summary: {errorMessage(error)}</p>
      ) : null}

      {!error && !isLoading && data ? (
        <Card className="flex flex-col gap-4 p-4">
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
        </Card>
      ) : null}

      <div className="mt-4">
        <Button onClick={() => void navigate("/nutrition/meals")}>View meal log</Button>
      </div>
    </section>
  );
}
