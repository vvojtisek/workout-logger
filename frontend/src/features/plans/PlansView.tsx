import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";

import { useListVersion } from "@/app/MasterDetail";
import { apiFetch, errorMessage } from "@/api/client";
import type {
  Location,
  LocationCheck,
  Paginated,
  WorkoutPlan,
  WorkoutSession,
} from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { LocationCheckDialog } from "@/features/locations/LocationCheckDialog";
import { readTrainingLocation, writeTrainingLocation } from "@/lib/locations";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, PageHeading } from "@/ui";

export function PlansView() {
  const listVersion = useListVersion();
  const { openSession } = useAppContext();
  const navigate = useNavigate();
  const selectedId = useMatch("/plans/:planId/edit")?.params.planId ?? null;
  const [deleteTarget, setDeleteTarget] = useState<WorkoutPlan | null>(null);
  const [pickedLocation, setPickedLocation] = useState<string | null>(null);
  const [pendingCheck, setPendingCheck] = useState<{
    session: WorkoutSession;
    check: LocationCheck;
  } | null>(null);
  const { data: locationData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => apiFetch<Paginated<Location>>("/locations?limit=100"),
  });
  const locations = locationData?.items ?? [];
  // Until a pick in this visit, use the one remembered from last time.
  const locationId =
    pickedLocation ??
    readTrainingLocation(
      window.localStorage,
      locations.map((location) => location.id),
    );

  function pickLocation(id: string) {
    setPickedLocation(id);
    writeTrainingLocation(window.localStorage, id);
  }

  const {
    data: planData,
    error: loadError,
    isLoading: loading,
    refetch,
  } = useQuery({
    // Its own key (a sub-key of "plans", so saves still invalidate it) and always
    // fresh on mount: Today caches a different "plans" query for 30 seconds.
    queryKey: ["plans", "list"],
    queryFn: () => apiFetch<Paginated<WorkoutPlan>>("/plans?limit=100"),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const plans = planData?.items ?? [];
  const error = loadError ? `Failed to load plans: ${errorMessage(loadError)}` : null;
  const load = () => void refetch();

  // Also reload after the detail beside the list closes (see MasterDetail).
  useEffect(() => {
    if (listVersion > 0) void refetch();
  }, [listVersion, refetch]);

  async function startWorkout(planId: string) {
    try {
      const session = await apiFetch<WorkoutSession>("/workout-sessions", {
        method: "POST",
        body: JSON.stringify({ source_plan_id: planId, location_id: locationId || null }),
      });
      if (session.location_id) {
        // Advisory only: if the check fails, the workout still starts.
        const check = await apiFetch<LocationCheck>(
          `/workout-sessions/${session.id}/location-check`,
        ).catch(() => null);
        if (check && check.items.length > 0) {
          setPendingCheck({ session, check });
          return;
        }
      }
      openSession(session);
    } catch (err) {
      toast.error(`Failed to start workout: ${errorMessage(err)}`);
    }
  }

  async function deletePlan(plan: WorkoutPlan) {
    try {
      await apiFetch(`/plans/${plan.id}`, { method: "DELETE" });
      toast.success(`Deleted "${plan.name}"`);
      load();
    } catch (err) {
      toast.error(`Failed to delete plan: ${errorMessage(err)}`);
    }
  }

  async function duplicatePlan(plan: WorkoutPlan) {
    try {
      const full = await apiFetch<WorkoutPlan>(`/plans/${plan.id}`);
      const exercises = full.exercises.map((ex) => ({
        exercise_name: ex.exercise_name,
        exercise_kind: ex.exercise_kind,
        target_sets: ex.target_sets,
        target_reps_min: ex.target_reps_min,
        target_reps_max: ex.target_reps_max,
        target_rir: ex.target_rir,
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
      load();
    } catch (err) {
      toast.error(`Failed to duplicate plan: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="plans-view">
      <div className="mb-5 flex items-start justify-between gap-3 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <PageHeading hint="Start a planned session, or manage the plans you already have.">
          Workout Plans
        </PageHeading>
        <Button variant="primary" onClick={() => void navigate("/plans/new")}>
          New program
        </Button>
      </div>
      {locations.length > 0 ? (
        <div className="mb-4 max-w-xs">
          <label className="field-label" htmlFor="training-location">
            Training at
          </label>
          <select
            id="training-location"
            className="input"
            value={locationId}
            onChange={(event) => pickLocation(event.target.value)}
          >
            <option value="">Anywhere</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <ul id="plans-list" className="flex flex-col">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && plans.length === 0 ? (
          <li>
            <EmptyState
              title="No workout plans yet"
              description="Tap 'New program' to create your first plan."
            />
          </li>
        ) : null}
        {plans.map((plan) => {
          const sets = plan.exercises.reduce((total, ex) => total + ex.target_sets, 0);
          return (
            <li
              key={plan.id}
              aria-current={plan.id === selectedId ? "true" : undefined}
              className={`border-b border-line-muted py-3 ${
                plan.id === selectedId ? "-mx-2 rounded-md bg-accent-soft px-2" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate font-medium">{plan.name}</p>
                <p className="shrink-0 font-mono text-xs text-muted" data-numeric>
                  {plan.exercises.length} ex · {sets} sets
                </p>
              </div>
              {plan.description ? (
                <p className="mt-0.5 truncate text-sm text-muted">{plan.description}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <Button
                  variant="primary"
                  className="px-3"
                  aria-label="Start workout"
                  onClick={() => void startWorkout(plan.id)}
                >
                  <span className="lg:hidden">Start workout</span>
                  <span aria-hidden="true" className="hidden lg:inline">
                    Start
                  </span>
                </Button>
                <Button variant="ghost" className="px-2.5" onClick={() => void navigate(`/plans/${plan.id}/edit`)}>
                  Edit
                </Button>
                <Button variant="ghost" className="px-2.5" onClick={() => void duplicatePlan(plan)}>
                  Duplicate
                </Button>
                <Button variant="ghost" className="px-2.5" onClick={() => setDeleteTarget(plan)}>
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {pendingCheck ? (
        <LocationCheckDialog
          session={pendingCheck.session}
          check={pendingCheck.check}
          onDone={(session) => {
            setPendingCheck(null);
            openSession(session);
          }}
        />
      ) : null}

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
