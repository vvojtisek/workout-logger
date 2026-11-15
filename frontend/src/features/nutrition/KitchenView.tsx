import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { ApiError, apiFetch, errorMessage } from "@/api/client";
import type { DayPlan, GroceryLine, GroceryList, PlannedMeal, SupplementsDue } from "@/api/types";
import {
  MEAL_TYPE_LABELS,
  TIMING_LABELS,
  dayOptions,
  groceryKey,
  quantityText,
  rangeEnd,
  sortGrocery,
  timingRank,
} from "@/lib/kitchen";
import { localIsoDate } from "@/lib/today";
import { toast } from "@/ui/Toast";
import { Button, PageHeading } from "@/ui";

type Mode = "kitchen" | "store";

const KITCHEN_KEY = ["kitchen"] as const;
const STORE_SPANS = [1, 3, 7] as const;

/** A day without a plan answers 404; that is an empty day, not an error. */
async function fetchDay(date: string): Promise<DayPlan | null> {
  try {
    return await apiFetch<DayPlan>(`/meal-plans/${date}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Kitchen & Store: today's meals with exact weights and prep steps for
 * cooking, and the shopping list the plans add up to for the store. High
 * contrast, large targets, every tick saved at once and shown before the
 * server answers. */
export function KitchenView() {
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => dayOptions(now, 7), [now]);
  const [mode, setMode] = useState<Mode>("kitchen");
  const [day, setDay] = useState(localIsoDate(now));
  const [span, setSpan] = useState<(typeof STORE_SPANS)[number]>(3);

  return (
    <section id="kitchen-view" className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeading hint="Cook from today's plan, then shop from the list it adds up to.">Kitchen &amp; Store</PageHeading>
      <div role="tablist" aria-label="Mode" className="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-line p-1">
        {(["kitchen", "store"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`kitchen-tab-${item}`}
            aria-selected={mode === item}
            aria-controls={`kitchen-panel-${item}`}
            onClick={() => setMode(item)}
            className={`min-h-11 rounded-[var(--radius-sm)] text-base font-semibold ${
              mode === item ? "bg-accent text-on-accent" : "text-main"
            }`}
          >
            {item === "kitchen" ? "Kitchen" : "Store"}
          </button>
        ))}
      </div>

      {mode === "kitchen" ? (
        <div role="tabpanel" id="kitchen-panel-kitchen" aria-labelledby="kitchen-tab-kitchen" className="flex flex-col gap-4">
          <div role="group" aria-label="Day" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {days.map((option) => (
              <button
                key={option.iso}
                type="button"
                aria-pressed={day === option.iso}
                onClick={() => setDay(option.iso)}
                className={`min-h-11 shrink-0 rounded-full border px-3.5 text-sm font-medium ${
                  day === option.iso ? "border-accent bg-accent-soft text-main" : "border-line bg-elevated text-main"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <KitchenDay date={day} />
        </div>
      ) : (
        <div role="tabpanel" id="kitchen-panel-store" aria-labelledby="kitchen-tab-store" className="flex flex-col gap-4">
          <div role="group" aria-label="Shopping for" className="flex gap-1.5">
            {STORE_SPANS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={span === option}
                onClick={() => setSpan(option)}
                className={`min-h-11 rounded-full border px-3.5 text-sm font-medium ${
                  span === option ? "border-accent bg-accent-soft text-main" : "border-line bg-elevated text-main"
                }`}
              >
                {option === 1 ? "Today" : `${option} days`}
              </button>
            ))}
          </div>
          <StoreList start={localIsoDate(now)} end={rangeEnd(localIsoDate(now), span)} />
        </div>
      )}
    </section>
  );
}

function KitchenDay({ date }: { date: string }) {
  const queryClient = useQueryClient();
  const dayKey = [...KITCHEN_KEY, "day", date];
  const plan = useQuery({ queryKey: dayKey, queryFn: () => fetchDay(date), staleTime: 0 });

  const prepared = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      apiFetch<DayPlan>(`/meal-plans/ingredients/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ prepared: value }),
      }),
    onMutate: ({ id, value }) => {
      const previous = queryClient.getQueryData<DayPlan | null>(dayKey);
      queryClient.setQueryData<DayPlan | null>(dayKey, (current) =>
        current
          ? {
              ...current,
              meals: current.meals.map((meal) => ({
                ...meal,
                ingredients: meal.ingredients.map((item) => (item.id === id ? { ...item, prepared: value } : item)),
              })),
            }
          : current,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(dayKey, context?.previous);
      toast.error(`Failed to save: ${errorMessage(err)}`);
    },
  });

  const eaten = useMutation({
    mutationFn: ({ meal, value }: { meal: PlannedMeal; value: boolean }) =>
      apiFetch<DayPlan>(`/meal-plans/meals/${meal.id}/eaten`, { method: value ? "POST" : "DELETE" }),
    onMutate: ({ meal, value }) => {
      const previous = queryClient.getQueryData<DayPlan | null>(dayKey);
      queryClient.setQueryData<DayPlan | null>(dayKey, (current) =>
        current
          ? {
              ...current,
              meals: current.meals.map((item) =>
                item.id === meal.id ? { ...item, eaten_meal_entry_id: value ? "pending" : null } : item,
              ),
            }
          : current,
      );
      return { previous };
    },
    onSuccess: (saved, { meal, value }) => {
      queryClient.setQueryData(dayKey, saved);
      // Today's food totals read the meal log this just wrote to.
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      if (value) toast.success(`${meal.name} logged as eaten`);
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(dayKey, context?.previous);
      toast.error(`Failed to log meal: ${errorMessage(err)}`);
    },
  });

  if (plan.isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (plan.isError) return <p className="text-sm text-danger">Failed to load the plan: {errorMessage(plan.error)}</p>;

  return (
    <div className="flex flex-col gap-5">
      <Supplements date={date} />
      {plan.data === null ? (
        <p data-testid="kitchen-empty" className="rounded-[var(--radius-md)] border border-line px-4 py-6 text-center text-base">
          No meal plan for this day yet. Your AI coach writes them over MCP.
        </p>
      ) : (
        <>
          <Targets plan={plan.data} />
          {plan.data.notes ? <p className="text-sm text-muted">{plan.data.notes}</p> : null}
          {[...plan.data.meals]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((meal) => (
              <MealCard
                key={meal.id}
                meal={meal}
                onPrepared={(id, value) => prepared.mutate({ id, value })}
                onEaten={(value) => eaten.mutate({ meal, value })}
              />
            ))}
        </>
      )}
    </div>
  );
}

function Targets({ plan }: { plan: DayPlan }) {
  const eaten = plan.meals.filter((meal) => meal.eaten_meal_entry_id);
  const sum = (pick: (meal: PlannedMeal) => number | null) =>
    Math.round(eaten.reduce((total, meal) => total + (pick(meal) ?? 0), 0));
  const rows: { label: string; eaten: number; target: number | null; unit: string }[] = [
    { label: "Energy", eaten: sum((meal) => meal.energy_kcal), target: plan.energy_target_kcal, unit: "kcal" },
    { label: "Protein", eaten: sum((meal) => meal.protein_g), target: plan.protein_target_g, unit: "g" },
    { label: "Fibre", eaten: sum((meal) => meal.fiber_g), target: plan.fiber_target_g, unit: "g" },
  ];
  return (
    <dl data-testid="kitchen-targets" className="grid grid-cols-3 gap-2 border-y border-line py-3">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col">
          <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{row.label}</dt>
          <dd data-numeric className="text-base font-semibold">
            {row.eaten}
            {row.target != null ? <span className="text-muted"> / {Math.round(row.target)}</span> : null}
            <span className="ml-1 text-xs font-normal text-muted">{row.unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CheckRow({
  checked,
  onChange,
  children,
  testId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <label
      data-testid={testId}
      data-checked={checked ? "true" : "false"}
      className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line-muted py-1.5 last:border-b-0"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-6 shrink-0 accent-[var(--color-accent)]"
      />
      <span className={`flex min-w-0 flex-1 items-baseline justify-between gap-3 text-base ${checked ? "text-muted line-through" : "text-main"}`}>
        {children}
      </span>
    </label>
  );
}

function MealCard({
  meal,
  onPrepared,
  onEaten,
}: {
  meal: PlannedMeal;
  onPrepared: (id: string, value: boolean) => void;
  onEaten: (value: boolean) => void;
}) {
  const isEaten = meal.eaten_meal_entry_id !== null;
  return (
    <article
      data-testid="kitchen-meal"
      aria-label={meal.name}
      className={`flex flex-col gap-3 rounded-[var(--radius-md)] border-2 p-4 ${isEaten ? "border-line-muted" : "border-line"}`}
    >
      <header className="flex flex-col gap-0.5">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">{MEAL_TYPE_LABELS[meal.meal_type]}</p>
        <h3 className="text-lg font-semibold">{meal.name}</h3>
        <p data-numeric className="text-sm text-muted">
          {Math.round(meal.energy_kcal)} kcal · P {Math.round(meal.protein_g)} g · C {Math.round(meal.carbohydrate_g)} g · F{" "}
          {Math.round(meal.fat_g)} g{meal.fiber_g != null ? ` · Fibre ${Math.round(meal.fiber_g)} g` : ""}
        </p>
      </header>
      <div role="group" aria-label={`${meal.name} ingredients`}>
        {meal.ingredients.map((item) => (
          <CheckRow key={item.id} testId="kitchen-ingredient" checked={item.prepared} onChange={(value) => onPrepared(item.id, value)}>
            <span className="min-w-0">
              {item.name}
              {item.note ? <span className="text-sm text-muted"> · {item.note}</span> : null}
            </span>
            <span data-numeric className="shrink-0 font-semibold">
              {quantityText(item.quantity, item.unit)}
            </span>
          </CheckRow>
        ))}
      </div>
      {meal.prep_steps.length > 0 ? (
        <ol className="flex list-decimal flex-col gap-1.5 pl-6 text-base" aria-label={`${meal.name} steps`}>
          {meal.prep_steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      ) : null}
      {isEaten ? (
        <div className="flex items-center justify-between gap-3">
          <p data-testid="kitchen-eaten" className="text-base font-semibold text-success">
            Logged as eaten
          </p>
          <Button touch variant="ghost" onClick={() => onEaten(false)}>
            Undo
          </Button>
        </div>
      ) : (
        <Button touch variant="primary" onClick={() => onEaten(true)}>
          Logged as eaten
        </Button>
      )}
    </article>
  );
}

function Supplements({ date }: { date: string }) {
  const queryClient = useQueryClient();
  const key = [...KITCHEN_KEY, "supplements", date];
  const due = useQuery({
    queryKey: key,
    staleTime: 0,
    queryFn: () => apiFetch<SupplementsDue>(`/supplements/due?date=${date}`),
  });
  const mark = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      apiFetch<SupplementsDue>(`/supplements/${id}/intakes/${date}`, { method: value ? "PUT" : "DELETE" }),
    onMutate: ({ id, value }) => {
      const previous = queryClient.getQueryData<SupplementsDue>(key);
      queryClient.setQueryData<SupplementsDue>(key, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.supplement.id === id ? { ...item, taken: value } : item)),
            }
          : current,
      );
      return { previous };
    },
    onSuccess: (saved) => queryClient.setQueryData(key, saved),
    onError: (err, _vars, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast.error(`Failed to save: ${errorMessage(err)}`);
    },
  });

  const items = [...(due.data?.items ?? [])].sort(
    (a, b) => timingRank(a.supplement.timing) - timingRank(b.supplement.timing),
  );
  if (items.length === 0) return null;
  const kind = due.data?.hockey_day ? "Hockey day" : due.data?.training_day ? "Training day" : "Rest day";
  return (
    <section aria-label="Supplements" data-testid="kitchen-supplements" className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Supplements</h3>
        <span className="text-xs text-muted">{kind}</span>
      </div>
      {items.map(({ supplement, taken }) => (
        <CheckRow
          key={supplement.id}
          testId="kitchen-supplement"
          checked={taken}
          onChange={(value) => mark.mutate({ id: supplement.id, value })}
        >
          <span className="min-w-0">
            {supplement.name}
            <span className="text-sm text-muted"> · {TIMING_LABELS[supplement.timing]}</span>
          </span>
          <span data-numeric className="shrink-0 font-semibold">
            {quantityText(supplement.dose, supplement.unit)}
          </span>
        </CheckRow>
      ))}
    </section>
  );
}

function StoreList({ start, end }: { start: string; end: string }) {
  const queryClient = useQueryClient();
  const key = [...KITCHEN_KEY, "grocery", start, end];
  const list = useQuery({
    queryKey: key,
    staleTime: 0,
    queryFn: () => apiFetch<GroceryList>(`/grocery-list?start=${start}&end=${end}`),
  });
  const check = useMutation({
    mutationFn: ({ line, value }: { line: GroceryLine; value: boolean }) =>
      apiFetch<null>("/grocery-list", { method: "PATCH", body: JSON.stringify({ ids: line.item_ids, checked: value }) }),
    onMutate: ({ line, value }) => {
      const previous = queryClient.getQueryData<GroceryList>(key);
      queryClient.setQueryData<GroceryList>(key, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (groceryKey(item) === groceryKey(line) ? { ...item, checked: value } : item)),
            }
          : current,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast.error(`Failed to save: ${errorMessage(err)}`);
    },
    // The kitchen's per-day copies of these items changed too.
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...KITCHEN_KEY, "day"] }),
  });

  if (list.isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (list.isError) return <p className="text-sm text-danger">Failed to load the list: {errorMessage(list.error)}</p>;
  const items = sortGrocery(list.data.items);
  if (items.length === 0) {
    return (
      <p data-testid="store-empty" className="rounded-[var(--radius-md)] border border-line px-4 py-6 text-center text-base">
        Nothing to buy: no meal plans in these days.
      </p>
    );
  }
  const left = items.filter((item) => !item.checked).length;
  return (
    <section aria-label="Shopping list" data-testid="store-list" className="flex flex-col">
      <p data-numeric className="mb-1 text-sm text-muted">
        {left} of {items.length} left
      </p>
      {items.map((line) => (
        <CheckRow
          key={groceryKey(line)}
          testId="store-item"
          checked={line.checked}
          onChange={(value) => check.mutate({ line, value })}
        >
          <span className="min-w-0">{line.name}</span>
          <span data-numeric className="shrink-0 font-semibold">
            {quantityText(line.quantity, line.unit)}
          </span>
        </CheckRow>
      ))}
    </section>
  );
}
