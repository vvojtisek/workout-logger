import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Food, MealEntry, MealType, Paginated } from "@/api/types";
import { mealEntryPayloadSchema } from "@/lib/meal-entry-schema";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

const MEAL_TYPE_OPTIONS: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

interface ItemRowState {
  key: string;
  mode: "food" | "custom";
  food_id: string;
  quantity: string;
  unit: string;
  food_name_snapshot: string;
  energy_kcal: string;
  protein_g: string;
  carbohydrate_g: string;
  fat_g: string;
  fiber_g: string;
}

function emptyRow(): ItemRowState {
  return {
    key: crypto.randomUUID(),
    mode: "food",
    food_id: "",
    quantity: "",
    unit: "",
    food_name_snapshot: "",
    energy_kcal: "",
    protein_g: "",
    carbohydrate_g: "",
    fat_g: "",
    fiber_g: "",
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function nowAsDatetimeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function rowFromItem(item: MealEntry["items"][number]): ItemRowState {
  const isFoodBacked = item.food_id !== null;
  return {
    key: item.id,
    mode: isFoodBacked ? "food" : "custom",
    food_id: item.food_id ?? "",
    quantity: String(item.quantity),
    unit: isFoodBacked ? "" : item.unit,
    food_name_snapshot: isFoodBacked ? "" : item.food_name_snapshot,
    energy_kcal: isFoodBacked ? "" : String(item.energy_kcal_snapshot),
    protein_g: isFoodBacked ? "" : String(item.protein_g_snapshot),
    carbohydrate_g: isFoodBacked ? "" : String(item.carbohydrate_g_snapshot),
    fat_g: isFoodBacked ? "" : String(item.fat_g_snapshot),
    fiber_g: isFoodBacked || item.fiber_g_snapshot == null ? "" : String(item.fiber_g_snapshot),
  };
}

function buildItemPayload(row: ItemRowState) {
  const num = (value: string) => (value.trim() ? Number.parseFloat(value) : Number.NaN);
  if (row.mode === "food") {
    return {
      food_id: row.food_id || null,
      quantity: num(row.quantity),
      unit: null,
      food_name_snapshot: null,
      energy_kcal: null,
      protein_g: null,
      carbohydrate_g: null,
      fat_g: null,
      fiber_g: null,
    };
  }
  return {
    food_id: null,
    quantity: num(row.quantity),
    unit: row.unit.trim() || null,
    food_name_snapshot: row.food_name_snapshot.trim() || null,
    energy_kcal: row.energy_kcal.trim() ? num(row.energy_kcal) : null,
    protein_g: row.protein_g.trim() ? num(row.protein_g) : null,
    carbohydrate_g: row.carbohydrate_g.trim() ? num(row.carbohydrate_g) : null,
    fat_g: row.fat_g.trim() ? num(row.fat_g) : null,
    fiber_g: row.fiber_g.trim() ? num(row.fiber_g) : null,
  };
}

function buildPayload(consumedAtLocal: string, mealType: MealType, notes: string, rows: ItemRowState[]) {
  return {
    consumed_at: consumedAtLocal ? new Date(consumedAtLocal).toISOString() : "",
    meal_type: mealType,
    notes: notes.trim() || null,
    items: rows.map(buildItemPayload),
  };
}

export function MealEntryForm() {
  const { entryId } = useParams<{ entryId: string }>();
  const isEditing = Boolean(entryId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [consumedAt, setConsumedAt] = useState(nowAsDatetimeLocal);
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<ItemRowState[]>([emptyRow()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seededEntryId = useRef<string | null>(null);

  const { data: foodsData } = useQuery({
    queryKey: ["foods"],
    queryFn: () => apiFetch<Paginated<Food>>("/foods?limit=100"),
  });
  const foods = foodsData?.items ?? [];

  const { data: existing, isLoading } = useQuery({
    queryKey: ["meal-entry", entryId],
    queryFn: () => apiFetch<MealEntry>(`/meal-entries/${entryId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existing || seededEntryId.current === existing.id) return;
    seededEntryId.current = existing.id;
    setConsumedAt(toDatetimeLocal(existing.consumed_at));
    setMealType(existing.meal_type);
    setNotes(existing.notes ?? "");
    setRows(existing.items.length > 0 ? existing.items.map(rowFromItem) : [emptyRow()]);
  }, [existing]);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing
        ? apiFetch<MealEntry>(`/meal-entries/${entryId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : apiFetch<MealEntry>("/meal-entries", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["meal-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["nutrition-daily"] });
      toast.success(isEditing ? "Updated meal entry" : "Logged meal entry");
      void navigate("/nutrition/meals");
    },
    onError: (err: unknown) => toast.error(`Failed to save: ${errorMessage(err)}`),
  });

  function updateRow(key: string, patch: Partial<ItemRowState>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function submit() {
    const payload = buildPayload(consumedAt, mealType, notes, rows);
    const result = mealEntryPayloadSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const [first, second] = issue.path;
        if (first === "items" && typeof second === "number") {
          nextErrors[`items.${second}`] = issue.message;
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
      <section id="meal-entry-form-view">
        <PageHeading>{isEditing ? "Edit Meal" : "Log Meal"}</PageHeading>
        <p className="text-sm text-muted">Loading entry…</p>
      </section>
    );
  }

  return (
    <section id="meal-entry-form-view">
      <PageHeading>{isEditing ? "Edit Meal" : "Log Meal"}</PageHeading>

      <Card className="flex flex-col gap-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="meal-consumed-at">
              Date and time
            </label>
            <Input
              id="meal-consumed-at"
              type="datetime-local"
              value={consumedAt}
              onChange={(e) => setConsumedAt(e.target.value)}
            />
            {errors.consumed_at ? (
              <p className="mt-1 text-sm text-danger">{errors.consumed_at}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="meal-type">
              Meal type
            </label>
            <select
              id="meal-type"
              className="input"
              value={mealType}
              onChange={(e) => setMealType(e.target.value as MealType)}
            >
              {MEAL_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="meal-notes">
            Notes (optional)
          </label>
          <textarea
            id="meal-notes"
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Card>

      <div className="mt-4">
        <h3 className="mb-2 font-medium">Items</h3>
        {errors.items ? <p className="mb-2 text-sm text-danger">{errors.items}</p> : null}
        <div id="meal-items-list" className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={row.key} className="meal-item-row card flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">Item {index + 1}</span>
                <div className="flex gap-1">
                  <Button
                    aria-label={`Toggle item ${index + 1} entry mode`}
                    onClick={() =>
                      updateRow(row.key, { mode: row.mode === "food" ? "custom" : "food" })
                    }
                  >
                    {row.mode === "food" ? "Use custom entry" : "Pick a food"}
                  </Button>
                  <Button
                    variant="danger"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => removeRow(row.key)}
                    disabled={rows.length === 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>

              {row.mode === "food" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor={`item-food-${row.key}`}>
                      Food
                    </label>
                    <select
                      id={`item-food-${row.key}`}
                      className="input"
                      value={row.food_id}
                      onChange={(e) => {
                        const food = foods.find((f) => f.id === e.target.value);
                        updateRow(row.key, {
                          food_id: e.target.value,
                          quantity: row.quantity || (food ? String(food.serving_quantity) : ""),
                        });
                      }}
                    >
                      <option value="">Select a food…</option>
                      {foods.map((food) => (
                        <option key={food.id} value={food.id}>
                          {food.name} ({food.serving_quantity} {food.serving_unit})
                        </option>
                      ))}
                    </select>
                    {errors[`items.${index}`] ? (
                      <p className="mt-1 text-sm text-danger">{errors[`items.${index}`]}</p>
                    ) : null}
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`item-quantity-${row.key}`}>
                      Quantity ({foods.find((f) => f.id === row.food_id)?.serving_unit ?? "unit"})
                    </label>
                    <Input
                      id={`item-quantity-${row.key}`}
                      type="number"
                      step="0.1"
                      value={row.quantity}
                      onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor={`item-name-${row.key}`}>
                      Name
                    </label>
                    <Input
                      id={`item-name-${row.key}`}
                      value={row.food_name_snapshot}
                      onChange={(e) => updateRow(row.key, { food_name_snapshot: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="field-label" htmlFor={`item-quantity-custom-${row.key}`}>
                        Quantity
                      </label>
                      <Input
                        id={`item-quantity-custom-${row.key}`}
                        type="number"
                        step="0.1"
                        value={row.quantity}
                        onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`item-unit-${row.key}`}>
                        Unit
                      </label>
                      <Input
                        id={`item-unit-${row.key}`}
                        placeholder="e.g. g, cup, each"
                        value={row.unit}
                        onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`item-energy-${row.key}`}>
                      Energy (kcal)
                    </label>
                    <Input
                      id={`item-energy-${row.key}`}
                      type="number"
                      value={row.energy_kcal}
                      onChange={(e) => updateRow(row.key, { energy_kcal: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`item-protein-${row.key}`}>
                      Protein (g)
                    </label>
                    <Input
                      id={`item-protein-${row.key}`}
                      type="number"
                      step="0.1"
                      value={row.protein_g}
                      onChange={(e) => updateRow(row.key, { protein_g: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`item-carbs-${row.key}`}>
                      Carbohydrate (g)
                    </label>
                    <Input
                      id={`item-carbs-${row.key}`}
                      type="number"
                      step="0.1"
                      value={row.carbohydrate_g}
                      onChange={(e) => updateRow(row.key, { carbohydrate_g: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`item-fat-${row.key}`}>
                      Fat (g)
                    </label>
                    <Input
                      id={`item-fat-${row.key}`}
                      type="number"
                      step="0.1"
                      value={row.fat_g}
                      onChange={(e) => updateRow(row.key, { fat_g: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor={`item-fiber-${row.key}`}>
                      Fiber (g, optional)
                    </label>
                    <Input
                      id={`item-fiber-${row.key}`}
                      type="number"
                      step="0.1"
                      value={row.fiber_g}
                      onChange={(e) => updateRow(row.key, { fiber_g: e.target.value })}
                    />
                  </div>
                  {errors[`items.${index}`] ? (
                    <p className="text-sm text-danger">{errors[`items.${index}`]}</p>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
        <Button
          id="add-item-btn"
          className="mt-3"
          onClick={() => setRows((current) => [...current, emptyRow()])}
        >
          + Add item
        </Button>
      </div>

      <div className="mt-5 flex gap-2">
        <Button
          id="save-meal-entry-btn"
          variant="primary"
          disabled={mutation.isPending}
          onClick={submit}
        >
          {isEditing ? "Save changes" : "Log meal"}
        </Button>
        <Button onClick={() => void navigate("/nutrition/meals")}>Cancel</Button>
      </div>
    </section>
  );
}
