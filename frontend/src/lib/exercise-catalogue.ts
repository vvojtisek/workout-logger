const PAGE_SIZE = 100;

export function exerciseListPath(query: string, offset = 0, locationId = ""): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  const term = query.trim();
  if (term) params.set("q", term);
  if (locationId) params.set("location_id", locationId);
  return `/exercises?${params.toString()}`;
}

interface NamePage {
  items: { name: string }[];
  total: number;
}

/** Collects every catalogue name, one page at a time, for plan-builder suggestions. */
export async function fetchCatalogueNames(
  fetchPage: (path: string) => Promise<NamePage>,
): Promise<string[]> {
  const names: string[] = [];
  for (;;) {
    const page = await fetchPage(exerciseListPath("", names.length));
    names.push(...page.items.map((item) => item.name));
    if (page.items.length === 0 || names.length >= page.total) return names;
  }
}

interface EntryPage<T> {
  items: T[];
  total: number;
}

/** Collects every catalogue entry, one page at a time. */
export async function fetchCatalogue<T>(
  fetchPage: (path: string) => Promise<EntryPage<T>>,
): Promise<T[]> {
  const entries: T[] = [];
  for (;;) {
    const page = await fetchPage(exerciseListPath("", entries.length));
    entries.push(...page.items);
    if (page.items.length === 0 || entries.length >= page.total) return entries;
  }
}
