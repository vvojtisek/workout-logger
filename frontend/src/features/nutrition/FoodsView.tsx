import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Food, Paginated } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, Input, PageHeading } from "@/ui";

export function FoodsView() {
  const navigate = useNavigate();
  const [foods, setFoods] = useState<Food[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Food | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const search = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "";
      const data = await apiFetch<Paginated<Food>>(`/foods?limit=100${search}`);
      setFoods(data.items);
      setError(null);
    } catch (err) {
      setError(`Failed to load foods: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void load(query), 200);
    return () => clearTimeout(timeout);
  }, [query, load]);

  async function deleteFood(food: Food) {
    try {
      await apiFetch(`/foods/${food.id}`, { method: "DELETE" });
      toast.success(`Deleted "${food.name}"`);
      void load(query);
    } catch (err) {
      toast.error(`Failed to delete food: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="foods-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Reusable foods for meal logging. Editing or deleting one never changes logged meal history.">
          Foods
        </PageHeading>
        <Button variant="primary" onClick={() => void navigate("/nutrition/foods/new")}>
          New food
        </Button>
      </div>

      <div className="mb-4">
        <Input
          aria-label="Search foods"
          placeholder="Search by name or brand…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <ul id="foods-list" className="flex flex-col gap-3">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && foods.length === 0 ? (
          <li>
            <EmptyState
              title="No foods found"
              description="Tap 'New food' to add your first catalogue entry."
            />
          </li>
        ) : null}
        {foods.map((food) => (
          <li key={food.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium">
                {food.name}
                {food.brand ? <span className="text-muted"> · {food.brand}</span> : null}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                Per {food.serving_quantity} {food.serving_unit}: {food.energy_kcal} kcal ·{" "}
                {food.protein_g}g protein · {food.carbohydrate_g}g carbs · {food.fat_g}g fat
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void navigate(`/nutrition/foods/${food.id}/edit`)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => setDeleteTarget(food)}>
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
          if (deleteTarget) void deleteFood(deleteTarget);
        }}
        title="Delete food"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? Meal entries that already reference it keep their nutrition snapshot.`}
        confirmLabel="Delete"
      />
    </section>
  );
}
