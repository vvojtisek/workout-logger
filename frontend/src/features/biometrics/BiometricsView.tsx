import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { BodyMetric } from "@/api/types";
import { formatWeightKg } from "@/lib/units";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, PageHeading } from "@/ui";
import { formatDateTime } from "@/lib/format";

import { useBodyEntries } from "@/features/body/entries";
import { EntryDateFilter, useEntryDates } from "@/features/trends/EntryDateFilter";

export function BiometricsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<BodyMetric | null>(null);

  const { from, to, suffix } = useEntryDates();
  const listQuery = useBodyEntries(from, to);

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

  const entries = listQuery.data ?? [];

  return (
    <section id="biometrics-view">
      <div className="mb-5 flex items-start justify-between gap-3 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <PageHeading hint="Track weight, body fat, and body measurements over time.">
          Biometrics
        </PageHeading>
        <Button variant="primary" onClick={() => void navigate(`/biometrics/new${suffix}`)}>
          Log entry
        </Button>
      </div>

      <EntryDateFilter clearTo="/biometrics" />

      <ul id="biometrics-list" className="flex flex-col gap-3">
        {listQuery.error ? (
          <li className="text-sm text-danger">
            Failed to load entries: {errorMessage(listQuery.error)}
          </li>
        ) : null}
        {listQuery.isSuccess && entries.length === 0 ? (
          <li>
            <EmptyState title={suffix ? "No measurements in this date range" : "No measurements logged yet"} />
          </li>
        ) : null}
        {entries.map((metric) => (
          <li key={metric.id} className="block-flat flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="font-medium tabular-nums">{formatWeightKg(metric.weight_kg)}</p>
              <p className="mt-0.5 text-sm text-muted">
                {formatDateTime(metric.measured_at)}
                {metric.body_fat_percent != null ? ` · ${metric.body_fat_percent.toFixed(1)}% BF` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void navigate(`/biometrics/${metric.id}/edit${suffix}`)}>Edit</Button>
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
