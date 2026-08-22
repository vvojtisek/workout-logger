import { useCallback, useEffect, useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { Paginated, WorkoutPlan, WorkoutSession } from "@/api/types";
import { Button, EmptyState, PageHeading } from "@/ui";

export function PlansView({
  onSessionStarted,
}: {
  onSessionStarted: (session: WorkoutSession) => void;
}) {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      onSessionStarted(session);
    } catch (err) {
      window.alert(`Failed to start workout: ${errorMessage(err)}`);
    }
  }

  async function deletePlan(planId: string) {
    await apiFetch(`/plans/${planId}`, { method: "DELETE" });
    void load();
  }

  return (
    <section id="plans-view">
      <PageHeading hint="Start a planned session, or manage the plans you already have.">
        Workout Plans
      </PageHeading>
      <ul id="plans-list" className="flex flex-col gap-3">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && plans.length === 0 ? (
          <li>
            <EmptyState
              title="No workout plans yet"
              description="Create one through the API for now — the plan builder arrives in the next slice."
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
            <div className="flex shrink-0 gap-2">
              <Button variant="primary" onClick={() => void startWorkout(plan.id)}>
                Start workout
              </Button>
              <Button variant="ghost" onClick={() => void deletePlan(plan.id)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
