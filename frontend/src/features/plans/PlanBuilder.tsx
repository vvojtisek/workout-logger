import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, apiFetch, errorMessage } from "@/api/client";
import type { WorkoutPlan } from "@/api/types";
import { planPayloadSchema } from "@/lib/plan-schema";
import type { ExerciseKind } from "@/lib/workout-utils";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

const EXERCISE_KIND_LABELS: Record<ExerciseKind, string> = {
  strength: "Strength (weight, reps, RIR)",
  bodyweight: "Bodyweight (added weight, reps, band)",
  cardio: "Cardio (duration, distance, incline)",
};

interface ExerciseRowState {
  key: string;
  exercise_name: string;
  exercise_kind: ExerciseKind;
  target_sets: string;
  target_reps_min: string;
  target_reps_max: string;
  target_weight_kg: string;
  rest_time_seconds: string;
  notes: string;
  group_key: string;
}

function emptyRow(): ExerciseRowState {
  return {
    key: crypto.randomUUID(),
    exercise_name: "",
    exercise_kind: "strength",
    target_sets: "3",
    target_reps_min: "8",
    target_reps_max: "12",
    target_weight_kg: "",
    rest_time_seconds: "60",
    notes: "",
    group_key: "",
  };
}

function rowFromExercise(exercise: WorkoutPlan["exercises"][number]): ExerciseRowState {
  return {
    key: exercise.id,
    exercise_name: exercise.exercise_name,
    exercise_kind: exercise.exercise_kind,
    target_sets: String(exercise.target_sets),
    target_reps_min: String(exercise.target_reps_min),
    target_reps_max: String(exercise.target_reps_max),
    target_weight_kg: exercise.target_weight_kg != null ? String(exercise.target_weight_kg) : "",
    rest_time_seconds: String(exercise.rest_time_seconds),
    notes: exercise.notes ?? "",
    group_key: exercise.group_key ?? "",
  };
}

function buildPayload(name: string, description: string, rows: ExerciseRowState[]) {
  const groupCounters = new Map<string, number>();
  const exercises = rows.map((row) => {
    const groupKey = row.group_key.trim() || null;
    let groupOrder: number | null = null;
    if (groupKey) {
      const count = groupCounters.get(groupKey) ?? 0;
      groupOrder = count;
      groupCounters.set(groupKey, count + 1);
    }
    return {
      exercise_name: row.exercise_name.trim(),
      exercise_kind: row.exercise_kind,
      target_sets: Number.parseInt(row.target_sets, 10),
      target_reps_min: Number.parseInt(row.target_reps_min, 10),
      target_reps_max: Number.parseInt(row.target_reps_max, 10),
      target_weight_kg: row.target_weight_kg.trim()
        ? Number.parseFloat(row.target_weight_kg)
        : null,
      rest_time_seconds: row.rest_time_seconds.trim()
        ? Number.parseInt(row.rest_time_seconds, 10)
        : 60,
      notes: row.notes.trim() || null,
      group_key: groupKey,
      group_order: groupOrder,
    };
  });
  return { name: name.trim(), description: description.trim() || null, exercises };
}

export function PlanBuilder() {
  const { planId } = useParams<{ planId: string }>();
  const isEditing = Boolean(planId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<ExerciseRowState[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seededPlanId = useRef<string | null>(null);

  const { data: existingPlan, isLoading } = useQuery({
    queryKey: ["plan", planId],
    queryFn: () => apiFetch<WorkoutPlan>(`/plans/${planId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existingPlan || seededPlanId.current === existingPlan.id) return;
    seededPlanId.current = existingPlan.id;
    setName(existingPlan.name);
    setDescription(existingPlan.description ?? "");
    setRows(existingPlan.exercises.map(rowFromExercise));
  }, [existingPlan]);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing
        ? apiFetch<WorkoutPlan>(`/plans/${planId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : apiFetch<WorkoutPlan>("/plans", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
      toast.success(isEditing ? `Updated "${plan.name}"` : `Created "${plan.name}"`);
      void navigate("/plans");
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
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function moveRow(index: number, direction: -1 | 1) {
    setRows((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
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
        <PageHeading>{isEditing ? "Edit Program" : "New Program"}</PageHeading>
        <p className="text-sm text-muted">Loading plan…</p>
      </section>
    );
  }

  return (
    <section id="plan-builder-view">
      <PageHeading hint="Superset rows by giving them the same group name.">
        {isEditing ? "Edit Program" : "New Program"}
      </PageHeading>

      <Card className="flex flex-col gap-3 p-4">
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
          <textarea
            id="plan-description"
            className="input"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {errors.description ? (
            <p className="mt-1 text-sm text-danger">{errors.description}</p>
          ) : null}
        </div>
      </Card>

      <div className="mt-4">
        <h3 className="mb-2 font-medium">Exercises</h3>
        <div id="plan-exercises-list" className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.key} className="plan-exercise-row card flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Exercise {index + 1}</span>
                <div className="flex gap-1">
                  <Button
                    aria-label={`Move ${row.exercise_name || `exercise ${index + 1}`} up`}
                    disabled={index === 0}
                    onClick={() => moveRow(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    aria-label={`Move ${row.exercise_name || `exercise ${index + 1}`} down`}
                    disabled={index === rows.length - 1}
                    onClick={() => moveRow(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="danger"
                    aria-label={`Remove ${row.exercise_name || `exercise ${index + 1}`}`}
                    onClick={() => removeRow(row.key)}
                  >
                    Remove
                  </Button>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor={`exercise-name-${row.key}`}>
                  Exercise name
                </label>
                <Input
                  id={`exercise-name-${row.key}`}
                  value={row.exercise_name}
                  onChange={(event) => updateRow(row.key, { exercise_name: event.target.value })}
                />
                {errors[`${index}.exercise_name`] ? (
                  <p className="mt-1 text-sm text-danger">{errors[`${index}.exercise_name`]}</p>
                ) : null}
              </div>

              <div>
                <label className="field-label" htmlFor={`exercise-kind-${row.key}`}>
                  Exercise type
                </label>
                <select
                  id={`exercise-kind-${row.key}`}
                  className="input"
                  value={row.exercise_kind}
                  onChange={(event) =>
                    updateRow(row.key, { exercise_kind: event.target.value as ExerciseKind })
                  }
                >
                  {(Object.keys(EXERCISE_KIND_LABELS) as ExerciseKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {EXERCISE_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor={`exercise-sets-${row.key}`}>
                    Target sets
                  </label>
                  <Input
                    id={`exercise-sets-${row.key}`}
                    type="number"
                    min="1"
                    max="100"
                    value={row.target_sets}
                    onChange={(event) => updateRow(row.key, { target_sets: event.target.value })}
                  />
                  {errors[`${index}.target_sets`] ? (
                    <p className="mt-1 text-sm text-danger">{errors[`${index}.target_sets`]}</p>
                  ) : null}
                </div>
                <div>
                  <label className="field-label" htmlFor={`exercise-weight-${row.key}`}>
                    Target weight (kg)
                  </label>
                  <Input
                    id={`exercise-weight-${row.key}`}
                    type="number"
                    min="0"
                    step="0.5"
                    value={row.target_weight_kg}
                    onChange={(event) =>
                      updateRow(row.key, { target_weight_kg: event.target.value })
                    }
                  />
                  {errors[`${index}.target_weight_kg`] ? (
                    <p className="mt-1 text-sm text-danger">
                      {errors[`${index}.target_weight_kg`]}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="field-label" htmlFor={`exercise-reps-min-${row.key}`}>
                    Min reps
                  </label>
                  <Input
                    id={`exercise-reps-min-${row.key}`}
                    type="number"
                    min="1"
                    max="1000"
                    value={row.target_reps_min}
                    onChange={(event) =>
                      updateRow(row.key, { target_reps_min: event.target.value })
                    }
                  />
                  {errors[`${index}.target_reps_min`] ? (
                    <p className="mt-1 text-sm text-danger">
                      {errors[`${index}.target_reps_min`]}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="field-label" htmlFor={`exercise-reps-max-${row.key}`}>
                    Max reps
                  </label>
                  <Input
                    id={`exercise-reps-max-${row.key}`}
                    type="number"
                    min="1"
                    max="1000"
                    value={row.target_reps_max}
                    onChange={(event) =>
                      updateRow(row.key, { target_reps_max: event.target.value })
                    }
                  />
                  {errors[`${index}.target_reps_max`] ? (
                    <p className="mt-1 text-sm text-danger">
                      {errors[`${index}.target_reps_max`]}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="field-label" htmlFor={`exercise-rest-${row.key}`}>
                    Rest seconds
                  </label>
                  <Input
                    id={`exercise-rest-${row.key}`}
                    type="number"
                    min="0"
                    max="3600"
                    value={row.rest_time_seconds}
                    onChange={(event) =>
                      updateRow(row.key, { rest_time_seconds: event.target.value })
                    }
                  />
                  {errors[`${index}.rest_time_seconds`] ? (
                    <p className="mt-1 text-sm text-danger">
                      {errors[`${index}.rest_time_seconds`]}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="field-label" htmlFor={`exercise-group-${row.key}`}>
                    Superset group
                  </label>
                  <Input
                    id={`exercise-group-${row.key}`}
                    placeholder="e.g. A"
                    value={row.group_key}
                    onChange={(event) => updateRow(row.key, { group_key: event.target.value })}
                  />
                  {errors[`${index}.group_key`] ? (
                    <p className="mt-1 text-sm text-danger">{errors[`${index}.group_key`]}</p>
                  ) : null}
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor={`exercise-notes-${row.key}`}>
                  Notes
                </label>
                <textarea
                  id={`exercise-notes-${row.key}`}
                  className="input"
                  rows={2}
                  value={row.notes}
                  onChange={(event) => updateRow(row.key, { notes: event.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
        <Button
          id="add-exercise-btn"
          className="mt-3"
          onClick={() => setRows((current) => [...current, emptyRow()])}
        >
          + Add exercise
        </Button>
      </div>

      <div className="mt-5 flex gap-2">
        <Button
          id="save-plan-btn"
          variant="primary"
          disabled={mutation.isPending}
          onClick={submit}
        >
          {isEditing ? "Save changes" : "Create program"}
        </Button>
        <Button onClick={() => void navigate("/plans")}>Cancel</Button>
      </div>
    </section>
  );
}
