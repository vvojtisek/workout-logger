import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Food } from "@/api/types";
import { foodPayloadSchema } from "@/lib/food-schema";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

interface FieldState {
  name: string;
  brand: string;
  serving_quantity: string;
  serving_unit: string;
  energy_kcal: string;
  protein_g: string;
  carbohydrate_g: string;
  fat_g: string;
  fiber_g: string;
}

function emptyFields(): FieldState {
  return {
    name: "",
    brand: "",
    serving_quantity: "100",
    serving_unit: "g",
    energy_kcal: "",
    protein_g: "",
    carbohydrate_g: "",
    fat_g: "",
    fiber_g: "",
  };
}

function fieldsFromFood(food: Food): FieldState {
  return {
    name: food.name,
    brand: food.brand ?? "",
    serving_quantity: String(food.serving_quantity),
    serving_unit: food.serving_unit,
    energy_kcal: String(food.energy_kcal),
    protein_g: String(food.protein_g),
    carbohydrate_g: String(food.carbohydrate_g),
    fat_g: String(food.fat_g),
    fiber_g: food.fiber_g != null ? String(food.fiber_g) : "",
  };
}

function buildPayload(fields: FieldState) {
  const num = (value: string) => (value.trim() ? Number.parseFloat(value) : Number.NaN);
  return {
    name: fields.name.trim(),
    brand: fields.brand.trim() || null,
    serving_quantity: num(fields.serving_quantity),
    serving_unit: fields.serving_unit.trim(),
    energy_kcal: num(fields.energy_kcal),
    protein_g: num(fields.protein_g),
    carbohydrate_g: num(fields.carbohydrate_g),
    fat_g: num(fields.fat_g),
    fiber_g: fields.fiber_g.trim() ? Number.parseFloat(fields.fiber_g) : null,
    source: "manual",
  };
}

export function FoodBuilder() {
  const { foodId } = useParams<{ foodId: string }>();
  const isEditing = Boolean(foodId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [fields, setFields] = useState<FieldState>(emptyFields);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seededFoodId = useRef<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["food", foodId],
    queryFn: () => apiFetch<Food>(`/foods/${foodId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existing || seededFoodId.current === existing.id) return;
    seededFoodId.current = existing.id;
    setFields(fieldsFromFood(existing));
  }, [existing]);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing
        ? apiFetch<Food>(`/foods/${foodId}`, { method: "PUT", body: JSON.stringify(payload) })
        : apiFetch<Food>("/foods", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (food) => {
      void queryClient.invalidateQueries({ queryKey: ["foods"] });
      toast.success(isEditing ? `Updated "${food.name}"` : `Created "${food.name}"`);
      void navigate("/nutrition/foods");
    },
    onError: (err: unknown) => toast.error(`Failed to save food: ${errorMessage(err)}`),
  });

  function update(key: keyof FieldState, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    const payload = buildPayload(fields);
    const result = foodPayloadSchema.safeParse(payload);
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
      <section id="food-builder-view">
        <PageHeading>{isEditing ? "Edit Food" : "New Food"}</PageHeading>
        <p className="text-sm text-muted">Loading food…</p>
      </section>
    );
  }

  return (
    <section id="food-builder-view">
      <PageHeading hint="Nutrition values are per serving. Meal items scale these by the logged quantity.">
        {isEditing ? "Edit Food" : "New Food"}
      </PageHeading>

      <Card className="flex flex-col gap-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="food-name">
              Name
            </label>
            <Input id="food-name" value={fields.name} onChange={(e) => update("name", e.target.value)} />
            {errors.name ? <p className="mt-1 text-sm text-danger">{errors.name}</p> : null}
          </div>
          <div>
            <label className="field-label" htmlFor="food-brand">
              Brand (optional)
            </label>
            <Input id="food-brand" value={fields.brand} onChange={(e) => update("brand", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="food-serving-quantity">
              Serving quantity
            </label>
            <Input
              id="food-serving-quantity"
              type="number"
              step="0.1"
              value={fields.serving_quantity}
              onChange={(e) => update("serving_quantity", e.target.value)}
            />
            {errors.serving_quantity ? (
              <p className="mt-1 text-sm text-danger">{errors.serving_quantity}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="food-serving-unit">
              Serving unit
            </label>
            <Input
              id="food-serving-unit"
              placeholder="e.g. g, ml, each"
              value={fields.serving_unit}
              onChange={(e) => update("serving_unit", e.target.value)}
            />
            {errors.serving_unit ? (
              <p className="mt-1 text-sm text-danger">{errors.serving_unit}</p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="food-energy">
              Energy (kcal)
            </label>
            <Input
              id="food-energy"
              type="number"
              step="1"
              value={fields.energy_kcal}
              onChange={(e) => update("energy_kcal", e.target.value)}
            />
            {errors.energy_kcal ? (
              <p className="mt-1 text-sm text-danger">{errors.energy_kcal}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="food-protein">
              Protein (g)
            </label>
            <Input
              id="food-protein"
              type="number"
              step="0.1"
              value={fields.protein_g}
              onChange={(e) => update("protein_g", e.target.value)}
            />
            {errors.protein_g ? <p className="mt-1 text-sm text-danger">{errors.protein_g}</p> : null}
          </div>
          <div>
            <label className="field-label" htmlFor="food-carbs">
              Carbohydrate (g)
            </label>
            <Input
              id="food-carbs"
              type="number"
              step="0.1"
              value={fields.carbohydrate_g}
              onChange={(e) => update("carbohydrate_g", e.target.value)}
            />
            {errors.carbohydrate_g ? (
              <p className="mt-1 text-sm text-danger">{errors.carbohydrate_g}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="food-fat">
              Fat (g)
            </label>
            <Input
              id="food-fat"
              type="number"
              step="0.1"
              value={fields.fat_g}
              onChange={(e) => update("fat_g", e.target.value)}
            />
            {errors.fat_g ? <p className="mt-1 text-sm text-danger">{errors.fat_g}</p> : null}
          </div>
          <div>
            <label className="field-label" htmlFor="food-fiber">
              Fiber (g, optional)
            </label>
            <Input
              id="food-fiber"
              type="number"
              step="0.1"
              value={fields.fiber_g}
              onChange={(e) => update("fiber_g", e.target.value)}
            />
          </div>
        </div>
      </Card>

      <div className="mt-5 flex gap-2">
        <Button id="save-food-btn" variant="primary" disabled={mutation.isPending} onClick={submit}>
          {isEditing ? "Save changes" : "Create food"}
        </Button>
        <Button onClick={() => void navigate("/nutrition/foods")}>Cancel</Button>
      </div>
    </section>
  );
}
