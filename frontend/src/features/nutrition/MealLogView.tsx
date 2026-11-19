import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useListVersion } from "@/app/MasterDetail";
import { apiFetch, errorMessage } from "@/api/client";
import type { MealEntry } from "@/api/types";
import { EntryDateFilter, useEntryDates } from "@/features/trends/EntryDateFilter";
import { fetchAllEntries } from "@/features/trends/series";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, PageHeading } from "@/ui";
import { formatDateTime } from "@/lib/format";

const MEAL_TYPE_LABELS: Record<MealEntry["meal_type"], string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function totalEnergy(entry: MealEntry): number {
  return entry.items.reduce((sum, item) => sum + item.energy_kcal_snapshot, 0);
}

export function MealLogView() {
  const listVersion = useListVersion();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { suffix } = useEntryDates();
  const [deleteTarget, setDeleteTarget] = useState<MealEntry | null>(null);
  const entriesQuery = useQuery({
    queryKey: ["meal-entries", suffix, listVersion],
    queryFn: ({ signal }) => fetchAllEntries<MealEntry>(`/meal-entries${suffix}`, signal),
  });
  const entries = entriesQuery.data ?? [];

  async function deleteEntry(entry: MealEntry) {
    try {
      await apiFetch(`/meal-entries/${entry.id}`, { method: "DELETE" });
      toast.success("Deleted meal entry");
      void queryClient.invalidateQueries({ queryKey: ["meal-entries"] });
    } catch (err) {
      toast.error(`Failed to delete: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="meal-log-view">
      <div className="mb-5 flex items-start justify-between gap-3 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <PageHeading hint="Everything you've logged, most recent first.">Meal Log</PageHeading>
        <Button variant="primary" onClick={() => void navigate(`/nutrition/meals/new${suffix}`)}>
          Log meal
        </Button>
      </div>
      <EntryDateFilter clearTo="/nutrition/meals" />
      <ul id="meal-entries-list" className="flex flex-col gap-3">
        {entriesQuery.error ? <li className="text-sm text-danger">{errorMessage(entriesQuery.error)}</li> : null}
        {entriesQuery.isSuccess && entries.length === 0 ? (
          <li>
            <EmptyState
              title={suffix ? "No meals in this date range" : "No meals logged yet"}
              description="Tap 'Log meal' to record what you ate."
            />
          </li>
        ) : null}
        {entries.map((entry) => (
          <li key={entry.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium">
                {MEAL_TYPE_LABELS[entry.meal_type]}
                <span className="ml-2 text-sm font-normal text-muted">
                  {formatDateTime(entry.consumed_at)}
                </span>
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {entry.items.map((item) => item.food_name_snapshot).join(", ")}
              </p>
              <p className="mt-1 text-xs text-muted tabular-nums">
                {totalEnergy(entry).toFixed(0)} kcal total
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void navigate(`/nutrition/meals/${entry.id}/edit${suffix}`)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => setDeleteTarget(entry)}>
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
          if (deleteTarget) void deleteEntry(deleteTarget);
        }}
        title="Delete meal entry"
        message="Are you sure you want to delete this meal entry? This cannot be undone."
        confirmLabel="Delete"
      />
    </section>
  );
}
