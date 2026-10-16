import type { Food, Paginated } from "@/api/types";

/** The fallback catalogue needs at least this many characters to search. */
export const CATALOG_MIN_QUERY = 2;

export function catalogSearchPath(query: string, limit = 20): string | null {
  const term = query.trim();
  if (term.length < CATALOG_MIN_QUERY) return null;
  const params = new URLSearchParams({ q: term, limit: String(limit) });
  return `/food-catalog?${params.toString()}`;
}

export function catalogAddPath(catalogId: string): string {
  return `/food-catalog/${encodeURIComponent(catalogId)}/add`;
}

/** Puts a food just added from the catalogue into a cached food list, kept
 * sorted by name like the server sorts it, so a picker can select it at once. */
export function withAddedFood(
  list: Paginated<Food> | undefined,
  food: Food,
): Paginated<Food> | undefined {
  if (!list || list.items.some((item) => item.id === food.id)) return list;
  const items = [...list.items, food].sort((a, b) => a.name.localeCompare(b.name));
  return { ...list, items, total: list.total + 1 };
}
