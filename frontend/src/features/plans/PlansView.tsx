import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Paginated, WorkoutPlan, WorkoutSession } from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, PageHeading } from "@/ui";

export function PlansView() {
  const { openSession } = useAppContext();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<WorkoutPlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Paginated<WorkoutPlan>>("/plans?limit=100");
      setPlans(data.items);
      setError(null);
    } catch (err) {
      setError(`Failed to load plans: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startWorkout(planId: string) {
    try {
      const session = await apiFetch<WorkoutSession>("/workout-sessions", {
        method: "POST",
        body: JSON.stringify({ source_plan_id: planId }),
      });
      openSession(session);
    } catch (err) {
      toast.error(`Failed to start workout: ${errorMessage(err)}`);
    }
  }

  async function deletePlan(plan: WorkoutPlan) {
    try {
      await apiFetch(`/plans/${plan.id}`, { method: "DELETE" });
      toast.success(`Deleted "${plan.name}"`);
      void load();
    } catch (err) {
      toast.error(`Failed to delete plan: ${errorMessage(err)}`);
    }
  }

  async function duplicatePlan(plan: WorkoutPlan) {
    try {
      const full = await apiFetch<WorkoutPlan>(`/plans/${plan.id}`);
      const exercises = full.exercises.map((ex) => ({
        exercise_name: ex.exercise_name,
        target_sets: ex.target_sets,
        target_reps_min: ex.target_reps_min,
        target_reps_max: ex.target_reps_max,
        target_weight_kg: ex.target_weight_kg,
        rest_time_seconds: ex.rest_time_seconds,
        notes: ex.notes,
        group_key: ex.group_key,
        group_order: ex.group_order,
      }));
      const copy = await apiFetch<WorkoutPlan>("/plans", {
        method: "POST",
        body: JSON.stringify({
          name: `${full.name} (copy)`,
          description: full.description,
          exercises,
        }),
      });
      toast.success(`Created "${copy.name}"`);
      void load();
    } catch (err) {
      toast.error(`Failed to duplicate plan: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="plans-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Start a planned session, or manage the plans you already have.">
          Workout Plans
        </PageHeading>
        <Button variant="primary" onClick={() => void navigate("/plans/new")}>
          New program
        </Button>
      </div>
      <ul id="plans-list" className="flex flex-col gap-3">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && plans.length === 0 ? (
          <li>
            <EmptyState
              title="No workout plans yet"
              description="Tap 'New program' to create your first plan."
            />
          </li>
        ) : null}
        {plans.map((plan) => (
          <li
            key={plan.id}
            className="card flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <p className="font-medium">{plan.name}</p>
              {plan.description ? (
                <p className="mt-0.5 text-sm text-muted">{plan.description}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted">
                {plan.exercises.length} exercise{plan.exercises.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="primary" onClick={() => void startWorkout(plan.id)}>
                Start workout
              </Button>
              <Button onClick={() => void navigate(`/plans/${plan.id}/edit`)}>
                Edit
              </Button>
              <Button onClick={() => void duplicatePlan(plan)}>
                Duplicate
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
        title="Delete plan"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
      />
    </section>
  );
}
