import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { NutritionPlan, Paginated } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, PageHeading } from "@/ui";

export function NutritionPlansView() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<NutritionPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<NutritionPlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Paginated<NutritionPlan>>("/nutrition-plans?limit=100");
      setPlans(data.items);
      setError(null);
    } catch (err) {
      setError(`Failed to load nutrition plans: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deletePlan(plan: NutritionPlan) {
    try {
      await apiFetch(`/nutrition-plans/${plan.id}`, { method: "DELETE" });
      toast.success(`Deleted "${plan.name}"`);
      void load();
    } catch (err) {
      toast.error(`Failed to delete plan: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="nutrition-plans-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Dated daily macro targets. Overlapping plans are allowed; the most recently started one applies.">
          Nutrition Plans
        </PageHeading>
        <Button variant="primary" onClick={() => void navigate("/nutrition/plans/new")}>
          New plan
        </Button>
      </div>
      <ul id="nutrition-plans-list" className="flex flex-col gap-3">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && plans.length === 0 ? (
          <li>
            <EmptyState
              title="No nutrition plans yet"
              description="Tap 'New plan' to set daily macro targets."
            />
          </li>
        ) : null}
        {plans.map((plan) => (
          <li key={plan.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium">{plan.name}</p>
              <p className="mt-0.5 text-sm text-muted">
                {plan.valid_from}
                {plan.valid_to ? ` – ${plan.valid_to}` : " – ongoing"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {plan.energy_target_kcal} kcal · {plan.protein_target_g}g protein ·{" "}
                {plan.carbohydrate_target_g}g carbs · {plan.fat_target_g}g fat
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void navigate(`/nutrition/plans/${plan.id}/edit`)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => setDeleteTarget(plan)}>
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
          if (deleteTarget) void deletePlan(deleteTarget);
        }}
        title="Delete nutrition plan"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
      />
    </section>
  );
}
