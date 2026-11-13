import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, apiFetch, errorMessage } from "@/api/client";
import type { CatalogExercise, Paginated, WorkoutPlan } from "@/api/types";
import { fetchCatalogueNames } from "@/lib/exercise-catalogue";
import {
  buildPayload,
  emptyRow,
  planSummary,
  rowFromExercise,
  supersetLabels,
  type ExerciseRowState,
} from "@/lib/plan-draft";
import { planPayloadSchema } from "@/lib/plan-schema";
import { useSettingsQuery } from "@/lib/settings-query";
import { useIsDesktop } from "@/lib/use-media-query";
import { Button, Input } from "@/ui";
import { toast } from "@/ui/Toast";
import { PlanExerciseRow, PlanTableHeader } from "./PlanExerciseRow";

/** Remounts the editor per plan, so switching plans in the list never leaks state. */
export function PlanBuilder() {
  const { planId } = useParams<{ planId: string }>();
  return <PlanEditor key={planId ?? "new"} planId={planId} />;
}

function PlanEditor({ planId }: { planId: string | undefined }) {
  const isEditing = Boolean(planId);
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<ExerciseRowState[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // What the server has, as a payload string, to tell whether there is anything to save.
  const [saved, setSaved] = useState(() =>
    JSON.stringify(buildPayload("", "", [])),
  );
  const seededPlanId = useRef<string | null>(null);
  const { data: settings } = useSettingsQuery();
  const compoundRestSeconds = settings?.default_rest_compound_seconds ?? 90;
  const isolationRestSeconds = settings?.default_rest_isolation_seconds ?? 60;

  const { data: existingPlan, isLoading } = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => apiFetch<WorkoutPlan>(`/plans/${planId}`),
    enabled: isEditing,
  });
  // Suggestions only: a name outside the catalogue is still a valid plan exercise.
  const { data: catalogueNames = [] } = useQuery({
    queryKey: ["exercise-catalogue-names"],
    queryFn: () => fetchCatalogueNames((path) => apiFetch<Paginated<CatalogExercise>>(path)),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!existingPlan || seededPlanId.current === existingPlan.id) return;
    seededPlanId.current = existingPlan.id;
    const seeded = existingPlan.exercises.map(rowFromExercise);
    setName(existingPlan.name);
    setDescription(existingPlan.description ?? "");
    setRows(seeded);
    setSaved(JSON.stringify(buildPayload(existingPlan.name, existingPlan.description ?? "", seeded)));
  }, [existingPlan]);

  const current = useMemo(() => buildPayload(name, description, rows), [name, description, rows]);
  const dirty = JSON.stringify(current) !== saved;
  const summary = planSummary(rows);
  const letters = supersetLabels(rows);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing
        ? apiFetch<WorkoutPlan>(`/plans/${planId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : apiFetch<WorkoutPlan>("/plans", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (plan, payload) => {
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
      void queryClient.invalidateQueries({ queryKey: ["plan", plan.id] });
      toast.success(isEditing ? `Updated "${plan.name}"` : `Created "${plan.name}"`);
      setSaved(JSON.stringify(payload));
      // Beside the list, stay on the plan so edits keep flowing; on a phone the
      // list is a separate screen, so go back to it.
      void navigate(isDesktop ? `/plans/${plan.id}/edit` : "/plans");
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === "PLAN_NAME_CONFLICT") {
        setErrors((prev) => ({ ...prev, name: err.message }));
        return;
      }
      toast.error(`Failed to save plan: ${errorMessage(err)}`);
    },
  });

  function updateRow(key: string, patch: Partial<ExerciseRowState>) {
    setRows((list) => list.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((list) => list.filter((row) => row.key !== key));
  }

  function moveRow(index: number, direction: -1 | 1) {
    setRows((list) => {
      const target = index + direction;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  function submit() {
    const payload = buildPayload(name, description, rows);
    const result = planPayloadSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const [first, second, third] = issue.path;
        if (first === "exercises" && typeof second === "number") {
          nextErrors[`${second}.${String(third)}`] = issue.message;
        } else {
          nextErrors[String(first)] = issue.message;
        }
      }
      setErrors(nextErrors);
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  if (isEditing && isLoading) {
    return (
      <section id="plan-builder-view">
        <h2 className="text-xl font-semibold tracking-tight">Edit Program</h2>
        <p className="mt-2 text-sm text-muted">Loading plan…</p>
      </section>
    );
  }

  return (
    <section id="plan-builder-view" className="pb-24">
      <datalist id="exercise-catalogue-names">
        {catalogueNames.map((catalogueName) => (
          <option key={catalogueName} value={catalogueName} />
        ))}
      </datalist>

      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">
          {isEditing ? "Edit Program" : "New Program"}
        </h2>
        <p className="font-mono text-sm text-muted" data-numeric data-testid="plan-summary">
          {summary.exercises} exercise{summary.exercises === 1 ? "" : "s"} · {summary.sets} sets
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <label className="field-label" htmlFor="plan-name">
            Plan name
          </label>
          <Input
            id="plan-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          {errors.name ? <p className="mt-1 text-sm text-danger">{errors.name}</p> : null}
        </div>
        <div>
          <label className="field-label" htmlFor="plan-description">
            Description
          </label>
          <Input
            id="plan-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {errors.description ? (
            <p className="mt-1 text-sm text-danger">{errors.description}</p>
          ) : null}
        </div>
      </div>

      <h3 className="mt-6 mb-1 font-medium">Exercises</h3>
      <p className="mb-2 text-sm text-muted">
        Superset rows by giving them the same group name. RIR is reps left in reserve; Side sets
        whether each limb is trained and logged on its own.
      </p>
      <PlanTableHeader />
      <div id="plan-exercises-list" className="flex flex-col">
        {rows.map((row, index) => (
          <PlanExerciseRow
            key={row.key}
            row={row}
            index={index}
            count={rows.length}
            superset={letters[index]}
            errors={errors}
            onChange={(patch) => updateRow(row.key, patch)}
            onMove={(direction) => moveRow(index, direction)}
            onRemove={() => removeRow(row.key)}
          />
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="border-b border-line-muted py-6 text-center text-sm text-muted">
          No exercises yet. Add one below.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          id="add-compound-exercise-btn"
          onClick={() => setRows((list) => [...list, emptyRow(compoundRestSeconds)])}
        >
          + Add compound exercise
        </Button>
        <Button
          id="add-isolation-exercise-btn"
          onClick={() => setRows((list) => [...list, emptyRow(isolationRestSeconds)])}
        >
          + Add isolation exercise
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Pre-fills rest seconds from your Settings defaults ({compoundRestSeconds}s compound,{" "}
        {isolationRestSeconds}s isolation) — change it per exercise as needed.
      </p>

      <div
        data-testid="plan-actions"
        className="sticky -bottom-8 lg:-bottom-16 -mx-4 mt-6 flex items-center gap-2 border-t border-line bg-canvas px-4 py-3 lg:-mx-0 lg:px-0"
      >
        <Button id="save-plan-btn" variant="primary" disabled={mutation.isPending} onClick={submit}>
          {isEditing ? "Save changes" : "Create program"}
        </Button>
        <Button onClick={() => void navigate("/plans")}>Cancel</Button>
        {dirty ? (
          <span role="status" className="ml-auto text-sm text-warn">
            Unsaved changes
          </span>
        ) : null}
      </div>
    </section>
  );
}
