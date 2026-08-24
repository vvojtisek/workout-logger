import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { MealEntry, Paginated } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, PageHeading } from "@/ui";

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
  const navigate = useNavigate();
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<MealEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Paginated<MealEntry>>("/meal-entries?limit=100");
      setEntries(data.items);
      setError(null);
    } catch (err) {
      setError(`Failed to load meal entries: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteEntry(entry: MealEntry) {
    try {
      await apiFetch(`/meal-entries/${entry.id}`, { method: "DELETE" });
      toast.success("Deleted meal entry");
      void load();
    } catch (err) {
      toast.error(`Failed to delete: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="meal-log-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Everything you've logged, most recent first.">Meal Log</PageHeading>
        <Button variant="primary" onClick={() => void navigate("/nutrition/meals/new")}>
          Log meal
        </Button>
      </div>
      <ul id="meal-entries-list" className="flex flex-col gap-3">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && entries.length === 0 ? (
          <li>
            <EmptyState
              title="No meals logged yet"
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
                  {new Date(entry.consumed_at).toLocaleString()}
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
              <Button onClick={() => void navigate(`/nutrition/meals/${entry.id}/edit`)}>
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
