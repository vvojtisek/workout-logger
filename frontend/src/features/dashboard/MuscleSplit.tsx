import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiFetch } from "@/api/client";
import type { CatalogExercise, Paginated, WorkoutLog } from "@/api/types";
import { muscleSplit } from "@/lib/dashboard-stats";
import { fetchCatalogue } from "@/lib/exercise-catalogue";

const RANGES = [7, 28] as const;

function label(muscle: string): string {
  const text = muscle.replace("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Sets per muscle group, busiest first. Muscles with nothing in the window
 * are kept and flagged, because the gap is the useful part. */
export function MuscleSplit({ logs }: { logs: WorkoutLog[] }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const catalogue = useQuery({
    queryKey: ["exercise-catalogue", "all"],
    staleTime: 5 * 60_000,
    queryFn: () =>
      fetchCatalogue((path) => apiFetch<Paginated<CatalogExercise>>(path)),
  });
  const split = useMemo(
    () => muscleSplit(logs, catalogue.data ?? [], { days }),
    [logs, catalogue.data, days],
  );
  const max = Math.max(...split.rows.map((row) => row.sets), 1);

  return (
    <section aria-labelledby="muscle-heading">
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <h3 id="muscle-heading" className="mr-auto text-sm font-semibold text-muted">
          Muscle-group split
        </h3>
        <div role="group" aria-label="Range" className="flex gap-1">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={days === range}
              onClick={() => setDays(range)}
              className={`min-h-11 rounded-full border px-4 text-sm ${
                days === range
                  ? "border-accent bg-accent-soft text-main"
                  : "border-line bg-elevated text-muted"
              }`}
            >
              {range} days
            </button>
          ))}
        </div>
      </div>
      {catalogue.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="muscle-split">
          {split.rows.map((row) => (
            <li
              key={row.muscle}
              data-muscle={row.muscle}
              data-sets={row.sets}
              className="grid grid-cols-[6rem_1fr_3.5rem] items-center gap-3 text-sm"
            >
              <span className={row.under ? "text-warn" : ""}>{label(row.muscle)}</span>
              <span className="h-2 overflow-hidden rounded-full bg-elevated">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${(row.sets / max) * 100}%` }}
                />
              </span>
              <span className={`text-right ${row.under ? "text-warn" : "text-muted"}`} data-numeric>
                {row.under ? "none" : Number.isInteger(row.sets) ? row.sets : row.sets.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="pt-2 text-xs text-dim">
        A set counts fully for the muscles it works directly and half for those that assist.
        {split.unmatchedSets > 0
          ? ` ${split.unmatchedSets} sets are not in the exercise catalogue and are left out.`
          : ""}
      </p>
    </section>
  );
}
