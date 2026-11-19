import { useQuery } from "@tanstack/react-query";

import type { BodyMetric, SleepEntry } from "@/api/types";
import { addTrendDays, fetchAllEntries } from "@/features/trends/series";

export function useBodyEntries(from: string | null, to: string | null, listVersion = 0) {
  const query = new URLSearchParams();
  if (from) query.set("date_from", new Date(`${from}T00:00`).toISOString());
  if (to) query.set("date_to", new Date(`${addTrendDays(to, 1)}T00:00`).toISOString());
  return useQuery({
    queryKey: ["body-metrics", from, to, listVersion],
    staleTime: 0,
    queryFn: ({ signal }) => fetchAllEntries<BodyMetric>(`/body-metrics?${query}`, signal),
  });
}

export function useSleepEntries(from: string | null, to: string | null, listVersion = 0) {
  const query = new URLSearchParams();
  // The calendar date comes from the zone saved with each entry. The API first
  // narrows the indexed UTC timestamp, then the recorded local date selects the rows.
  if (from) query.set("date_from", `${addTrendDays(from, -1)}T00:00:00Z`);
  if (to) query.set("date_to", `${addTrendDays(to, 2)}T00:00:00Z`);
  return useQuery({
    queryKey: ["sleep-entries", from, to, listVersion],
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const entries = await fetchAllEntries<SleepEntry>(`/sleep-entries?${query}`, signal);
      return entries.filter(({ sleep_date: date }) => (!from || date >= from) && (!to || date <= to));
    },
  });
}
