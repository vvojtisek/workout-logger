import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { CatalogFood, CatalogSearchResponse, Food, Paginated } from "@/api/types";
import { catalogAddPath, catalogSearchPath, withAddedFood } from "@/lib/food-catalog";
import { Button, Input } from "@/ui";
import { toast } from "@/ui/Toast";

/** Searches the bundled fallback catalogue for a food missing from the foods
 * list, and adds the picked entry to the foods in one step. */
export function CatalogQuickAdd({ idSuffix, onPicked }: { idSuffix: string; onPicked: (food: Food) => void }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setTerm(query), 200);
    return () => clearTimeout(timeout);
  }, [query]);

  const path = catalogSearchPath(term);
  const { data, isFetching, error } = useQuery({
    queryKey: ["food-catalog", path],
    queryFn: () => apiFetch<CatalogSearchResponse>(path ?? ""),
    enabled: path !== null,
  });

  const add = useMutation({
    mutationFn: (entry: CatalogFood) =>
      entry.food_id
        ? apiFetch<Food>(`/foods/${entry.food_id}`)
        : apiFetch<Food>(catalogAddPath(entry.catalog_id), { method: "POST" }),
    onSuccess: (food, entry) => {
      queryClient.setQueryData<Paginated<Food>>(["foods"], (list) => withAddedFood(list, food));
      void queryClient.invalidateQueries({ queryKey: ["foods"] });
      void queryClient.invalidateQueries({ queryKey: ["food-catalog"] });
      if (!entry.food_id) toast.success(`Added "${food.name}" to your foods`);
      onPicked(food);
    },
    onError: (err: unknown) => toast.error(`Failed to add food: ${errorMessage(err)}`),
  });

  const inputId = `catalog-search-${idSuffix}`;
  return (
    <div className="catalog-quick-add flex flex-col gap-2 rounded border border-dashed border-line p-2">
      <label className="field-label" htmlFor={inputId}>
        Search the full food catalogue
      </label>
      <Input
        id={inputId}
        type="search"
        placeholder="e.g. vločky, kuřecí prsa"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {path === null ? (
        <p className="text-sm text-muted">Type at least two letters. Values are per 100 g.</p>
      ) : error ? (
        <p className="text-sm text-danger">Search failed: {errorMessage(error)}</p>
      ) : data && data.items.length === 0 && !isFetching ? (
        <p className="text-sm text-muted">Nothing in the catalogue matches.</p>
      ) : data ? (
        <>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" aria-label="Catalogue results">
            {data.items.map((entry) => (
              <li key={entry.catalog_id} className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  {entry.name}{" "}
                  <span className="text-muted">
                    {entry.energy_kcal} kcal · P {entry.protein_g} · C {entry.carbohydrate_g} · F{" "}
                    {entry.fat_g}
                  </span>
                </span>
                <Button
                  aria-label={`${entry.food_id ? "Use" : "Add"} ${entry.name}`}
                  disabled={add.isPending}
                  onClick={() => add.mutate(entry)}
                >
                  {entry.food_id ? "Use" : "Add"}
                </Button>
              </li>
            ))}
          </ul>
          {data.total > data.items.length ? (
            <p className="text-sm text-muted">
              Showing {data.items.length} of {data.total}. Type more to narrow it down.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
