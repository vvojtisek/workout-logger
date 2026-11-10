import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { TrainingLoadResponse, TrainingLoadWeek } from "@/api/types";
import { isIsoCalendarDate } from "@/lib/date-time-inputs";
import { MUSCLE_LABELS } from "@/lib/exercise-catalogue";
import { formatDate } from "@/lib/format";
import { PageHeading } from "@/ui";

const WEEK_COUNTS = [4, 8, 12, 26];
const VOLUME_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function MuscleVolumeTable({ weeks }: { weeks: TrainingLoadWeek[] }) {
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const week = weeks.find((entry) => entry.week_start === selectedWeek) ?? weeks.at(-1);
  if (!week) return null;

  return (
    <section className="card mt-4 p-4">
      <h3 className="font-semibold">External volume by primary muscle</h3>
      <p className="my-2 text-sm text-muted">
        Volume is divided across each exercise's distinct primary tags. Untagged volume appears
        under Unclassified.
      </p>
      <label className="mb-3 flex flex-col gap-1">
        <span className="field-label">Muscle breakdown week</span>
        <select
          className="input w-fit"
          value={week.week_start}
          onChange={(event) => setSelectedWeek(event.target.value)}
        >
          {[...weeks].reverse().map((entry) => (
            <option key={entry.week_start} value={entry.week_start}>
              {entry.week_start}
            </option>
          ))}
        </select>
      </label>
      {week.muscle_volume.length > 0 ? (
        <table aria-label="External volume by primary muscle" className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-2">Muscle</th>
              <th scope="col" className="py-2 text-right">External volume</th>
            </tr>
          </thead>
          <tbody>
            {week.muscle_volume.map(({ muscle, volume_kg }) => (
              <tr key={muscle ?? "unclassified"} className="border-t border-line-muted">
                <th scope="row" className="py-2 font-medium">
                  {muscle === null ? "Unclassified" : MUSCLE_LABELS[muscle] ?? muscle}
                </th>
                <td className="py-2 text-right" data-numeric>{VOLUME_FORMAT.format(volume_kg)} kg</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p role="status" className="text-sm text-muted">No external volume recorded for this week.</p>
      )}
    </section>
  );
}

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
      {data ? <MuscleVolumeTable weeks={data.weeks} /> : null}
    </section>
  );
}
