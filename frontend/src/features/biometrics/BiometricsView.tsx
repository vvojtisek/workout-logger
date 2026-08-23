import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { BodyMetric, BodyMetricTrends, Paginated } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, Card, EmptyState, PageHeading } from "@/ui";

function formatDelta(value: number | null, unit: string): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} ${unit}`;
}

function TrendCard({ trends }: { trends: BodyMetricTrends }) {
  if (!trends.latest) {
    return (
      <EmptyState
        title="No biometrics logged yet"
        description="Log your first entry to start tracking weight and body composition trends."
      />
    );
  }
  return (
    <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
      <div>
        <p className="text-xs text-muted">Latest weight</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {trends.latest.weight_kg.toFixed(1)} kg
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">7-day change</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {formatDelta(trends.weight_kg_delta_7d, "kg")}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">14-day change</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {formatDelta(trends.weight_kg_delta_14d, "kg")}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">Body fat</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {trends.latest.body_fat_percent != null
            ? `${trends.latest.body_fat_percent.toFixed(1)}%`
            : "—"}
        </p>
      </div>
    </Card>
  );
}

export function BiometricsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<BodyMetric | null>(null);

  const trendsQuery = useQuery({
    queryKey: ["body-metrics-trends"],
    queryFn: () => apiFetch<BodyMetricTrends>("/body-metrics/trends"),
  });
  const listQuery = useQuery({
    queryKey: ["body-metrics"],
    queryFn: () => apiFetch<Paginated<BodyMetric>>("/body-metrics?limit=100"),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["body-metrics"] });
    void queryClient.invalidateQueries({ queryKey: ["body-metrics-trends"] });
  }

  async function deleteMetric(metric: BodyMetric) {
    try {
      await apiFetch(`/body-metrics/${metric.id}`, { method: "DELETE" });
      toast.success("Deleted entry");
      refresh();
    } catch (err) {
      toast.error(`Failed to delete: ${errorMessage(err)}`);
    }
  }

  const entries = listQuery.data?.items ?? [];

  return (
    <section id="biometrics-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Track weight, body fat, and body measurements over time.">
          Biometrics
        </PageHeading>
        <Button variant="primary" onClick={() => void navigate("/biometrics/new")}>
          Log entry
        </Button>
      </div>

      <div className="mb-5">
        {trendsQuery.error ? (
          <p className="text-sm text-danger">
            Failed to load trends: {errorMessage(trendsQuery.error)}
          </p>
        ) : trendsQuery.data ? (
          <TrendCard trends={trendsQuery.data} />
        ) : null}
      </div>

      <ul id="biometrics-list" className="flex flex-col gap-3">
        {listQuery.error ? (
          <li className="text-sm text-danger">
            Failed to load entries: {errorMessage(listQuery.error)}
          </li>
        ) : null}
        {entries.map((metric) => (
          <li key={metric.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium tabular-nums">{metric.weight_kg.toFixed(1)} kg</p>
              <p className="mt-0.5 text-sm text-muted">
                {new Date(metric.measured_at).toLocaleString()}
                {metric.body_fat_percent != null ? ` · ${metric.body_fat_percent.toFixed(1)}% BF` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void navigate(`/biometrics/${metric.id}/edit`)}>Edit</Button>
              <Button variant="ghost" onClick={() => setDeleteTarget(metric)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteMetric(deleteTarget);
        }}
        title="Delete entry"
        message="Are you sure you want to delete this biometrics entry? This cannot be undone."
        confirmLabel="Delete"
      />
    </section>
  );
}
