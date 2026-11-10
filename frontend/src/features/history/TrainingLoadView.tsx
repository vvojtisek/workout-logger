import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { TrainingLoadResponse } from "@/api/types";
import { isIsoCalendarDate } from "@/lib/date-time-inputs";
import { formatDate } from "@/lib/format";
import { PageHeading } from "@/ui";

const WEEK_COUNTS = [4, 8, 12, 26];
const VOLUME_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function TrainingLoadView() {
  const [weekOf, setWeekOf] = useState(() => formatDate(new Date().toISOString()));
  const [weeks, setWeeks] = useState(8);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const validDate = isIsoCalendarDate(weekOf);
  const { data, error, isPending } = useQuery({
    queryKey: ["training-load", weekOf, weeks, timezone],
    queryFn: () => {
      const params = new URLSearchParams({ week_of: weekOf, weeks: String(weeks), timezone });
      return apiFetch<TrainingLoadResponse>(`/training-load?${params.toString()}`);
    },
    enabled: validDate,
  });

  return (
    <section>
      <PageHeading hint="Review logged sets and external-load volume across Monday-start weeks.">
        Training load
      </PageHeading>
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className="field-label">Week containing</span>
          <input
            type="date"
            className="input"
            value={weekOf}
            onChange={(event) => setWeekOf(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="field-label">Weeks to show</span>
          <select
            className="input"
            value={weeks}
            onChange={(event) => setWeeks(Number(event.target.value))}
          >
            {WEEK_COUNTS.map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="mb-3 text-sm text-muted">
        Weeks use {timezone}. Gym sessions are workout records with logged exercise sets.
        Separate activities are excluded. Volume uses the recorded loads and catalogue load rules.
      </p>
      {!validDate || isPending ? (
        <p role="status" className="text-sm text-muted">
          {validDate ? "Loading weekly totals…" : "Choose a date to see weekly totals."}
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger">{errorMessage(error)}</p> : null}
      {data ? (
        <div className="card overflow-x-auto">
          <table aria-label="Weekly gym work" className="w-full text-left text-sm">
            <thead className="bg-elevated text-muted">
              <tr>
                <th scope="col" className="p-3">Week of</th>
                <th scope="col" className="p-3 text-right">Gym sessions</th>
                <th scope="col" className="p-3 text-right">Logged sets</th>
                <th scope="col" className="p-3 text-right">External volume</th>
              </tr>
            </thead>
            <tbody>
              {[...data.weeks].reverse().map((week) => (
                <tr key={week.week_start} className="border-t border-line-muted" data-numeric>
                  <th scope="row" className="p-3 font-medium">{week.week_start}</th>
                  <td className="p-3 text-right">{week.gym_sessions}</td>
                  <td className="p-3 text-right">{week.logged_sets}</td>
                  <td className="p-3 text-right whitespace-nowrap">{VOLUME_FORMAT.format(week.volume_kg)} kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
