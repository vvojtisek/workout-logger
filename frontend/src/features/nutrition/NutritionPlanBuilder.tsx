import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { NutritionPlan } from "@/api/types";
import { nutritionPlanPayloadSchema } from "@/lib/nutrition-plan-schema";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

interface FieldState {
  name: string;
  valid_from: string;
  valid_to: string;
  energy_target_kcal: string;
  protein_target_g: string;
  carbohydrate_target_g: string;
  fat_target_g: string;
  fiber_target_g: string;
}

function emptyFields(): FieldState {
  return {
    name: "",
    valid_from: "",
    valid_to: "",
    energy_target_kcal: "",
    protein_target_g: "",
    carbohydrate_target_g: "",
    fat_target_g: "",
    fiber_target_g: "",
  };
}

function fieldsFromPlan(plan: NutritionPlan): FieldState {
  return {
    name: plan.name,
    valid_from: plan.valid_from,
    valid_to: plan.valid_to ?? "",
    energy_target_kcal: String(plan.energy_target_kcal),
    protein_target_g: String(plan.protein_target_g),
    carbohydrate_target_g: String(plan.carbohydrate_target_g),
    fat_target_g: String(plan.fat_target_g),
    fiber_target_g: plan.fiber_target_g != null ? String(plan.fiber_target_g) : "",
  };
}

function buildPayload(fields: FieldState) {
  const num = (value: string) => (value.trim() ? Number.parseFloat(value) : Number.NaN);
  return {
    name: fields.name.trim(),
    valid_from: fields.valid_from,
    valid_to: fields.valid_to || null,
    energy_target_kcal: num(fields.energy_target_kcal),
    protein_target_g: num(fields.protein_target_g),
    carbohydrate_target_g: num(fields.carbohydrate_target_g),
    fat_target_g: num(fields.fat_target_g),
    fiber_target_g: fields.fiber_target_g.trim() ? Number.parseFloat(fields.fiber_target_g) : null,
  };
}

export function NutritionPlanBuilder() {
  const { planId } = useParams<{ planId: string }>();
  const isEditing = Boolean(planId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [fields, setFields] = useState<FieldState>(emptyFields);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seededPlanId = useRef<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["nutrition-plan", planId],
    queryFn: () => apiFetch<NutritionPlan>(`/nutrition-plans/${planId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existing || seededPlanId.current === existing.id) return;
    seededPlanId.current = existing.id;
    setFields(fieldsFromPlan(existing));
  }, [existing]);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing
        ? apiFetch<NutritionPlan>(`/nutrition-plans/${planId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : apiFetch<NutritionPlan>("/nutrition-plans", {
            method: "POST",
            body: JSON.stringify(payload),
          }),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({ queryKey: ["nutrition-plans"] });
      toast.success(isEditing ? `Updated "${plan.name}"` : `Created "${plan.name}"`);
      void navigate("/nutrition/plans");
    },
    onError: (err: unknown) => toast.error(`Failed to save plan: ${errorMessage(err)}`),
  });

  function update(key: keyof FieldState, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    const payload = buildPayload(fields);
    const result = nutritionPlanPayloadSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        nextErrors[String(issue.path[0])] = issue.message;
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
      <section id="nutrition-plan-builder-view">
        <PageHeading>{isEditing ? "Edit Nutrition Plan" : "New Nutrition Plan"}</PageHeading>
        <p className="text-sm text-muted">Loading plan…</p>
      </section>
    );
  }

  return (
    <section id="nutrition-plan-builder-view">
      <PageHeading>{isEditing ? "Edit Nutrition Plan" : "New Nutrition Plan"}</PageHeading>

      <Card className="flex flex-col gap-4 p-4">
        <div>
          <label className="field-label" htmlFor="nutrition-plan-name">
            Name
          </label>
          <Input
            id="nutrition-plan-name"
            value={fields.name}
            onChange={(e) => update("name", e.target.value)}
          />
          {errors.name ? <p className="mt-1 text-sm text-danger">{errors.name}</p> : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="nutrition-plan-start">
              Start date
            </label>
            <Input
              id="nutrition-plan-start"
              type="date"
              value={fields.valid_from}
              onChange={(e) => update("valid_from", e.target.value)}
            />
            {errors.valid_from ? (
              <p className="mt-1 text-sm text-danger">{errors.valid_from}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="nutrition-plan-end">
              End date (optional)
            </label>
            <Input
              id="nutrition-plan-end"
              type="date"
              value={fields.valid_to}
              onChange={(e) => update("valid_to", e.target.value)}
            />
            {errors.valid_to ? <p className="mt-1 text-sm text-danger">{errors.valid_to}</p> : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="nutrition-plan-energy">
              Energy target (kcal)
            </label>
            <Input
              id="nutrition-plan-energy"
              type="number"
              value={fields.energy_target_kcal}
              onChange={(e) => update("energy_target_kcal", e.target.value)}
            />
            {errors.energy_target_kcal ? (
              <p className="mt-1 text-sm text-danger">{errors.energy_target_kcal}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="nutrition-plan-protein">
              Protein target (g)
            </label>
            <Input
              id="nutrition-plan-protein"
              type="number"
              value={fields.protein_target_g}
              onChange={(e) => update("protein_target_g", e.target.value)}
            />
            {errors.protein_target_g ? (
              <p className="mt-1 text-sm text-danger">{errors.protein_target_g}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="nutrition-plan-carbs">
              Carbohydrate target (g)
            </label>
            <Input
              id="nutrition-plan-carbs"
              type="number"
              value={fields.carbohydrate_target_g}
              onChange={(e) => update("carbohydrate_target_g", e.target.value)}
            />
            {errors.carbohydrate_target_g ? (
              <p className="mt-1 text-sm text-danger">{errors.carbohydrate_target_g}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="nutrition-plan-fat">
              Fat target (g)
            </label>
            <Input
              id="nutrition-plan-fat"
              type="number"
              value={fields.fat_target_g}
              onChange={(e) => update("fat_target_g", e.target.value)}
            />
            {errors.fat_target_g ? (
              <p className="mt-1 text-sm text-danger">{errors.fat_target_g}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="nutrition-plan-fiber">
              Fiber target (g, optional)
            </label>
            <Input
              id="nutrition-plan-fiber"
              type="number"
              value={fields.fiber_target_g}
              onChange={(e) => update("fiber_target_g", e.target.value)}
            />
          </div>
        </div>
      </Card>

      <div className="mt-5 flex gap-2">
        <Button
          id="save-nutrition-plan-btn"
          variant="primary"
          disabled={mutation.isPending}
          onClick={submit}
        >
          {isEditing ? "Save changes" : "Create plan"}
        </Button>
        <Button onClick={() => void navigate("/nutrition/plans")}>Cancel</Button>
      </div>
    </section>
  );
}
