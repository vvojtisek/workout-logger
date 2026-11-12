import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch, apiFetchBlob, errorMessage, triggerBlobDownload } from "@/api/client";
import type { MovementPattern, TrainingLoadResponse, TrainingLoadWeek } from "@/api/types";
import { isIsoCalendarDate } from "@/lib/date-time-inputs";
import { MOVEMENT_PATTERN_LABELS, MUSCLE_LABELS } from "@/lib/exercise-catalogue";
import { formatDate } from "@/lib/format";
import { Button, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

const WEEK_COUNTS = [4, 8, 12, 26];
const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const BASELINE_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const RATIO_MESSAGES = {
  ready: "Comparison unavailable.",
  week_incomplete: "The selected week is still open or in the future.",
  missing_sessions: "At least one of the five weeks has no logged sessions.",
  missing_ratings: "At least one session in these weeks lacks a rating.",
  zero_baseline: "The four-week baseline has zero load.",
};

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
                <td className="py-2 text-right" data-numeric>{NUMBER_FORMAT.format(volume_kg)} kg</td>
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

function MovementPatternVolumeTable({ weeks }: { weeks: TrainingLoadWeek[] }) {
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const week = weeks.find((entry) => entry.week_start === selectedWeek) ?? weeks.at(-1);
  if (!week) return null;
  const rowData = new Map<MovementPattern | null, { volume: number; sets: number }>();
  for (const { movement_pattern, volume_kg } of week.movement_pattern_volume) {
    rowData.set(movement_pattern, {
      volume: volume_kg,
      sets: rowData.get(movement_pattern)?.sets ?? 0,
    });
  }
  for (const { movement_pattern, sets } of week.movement_pattern_sets) {
    rowData.set(movement_pattern, {
      volume: rowData.get(movement_pattern)?.volume ?? 0,
      sets,
    });
  }
  const rows = [...rowData].sort(([patternA, a], [patternB, b]) =>
    b.sets - a.sets || b.volume - a.volume ||
    (patternA ?? "unclassified").localeCompare(patternB ?? "unclassified"),
  );

  return (
    <section className="card mt-4 p-4">
      <h3 className="font-semibold">Work by primary movement pattern</h3>
      <p className="my-2 text-sm text-muted">
        Each exercise contributes its logged sets and external volume to one primary movement
        pattern. Bodyweight sets count even without external volume; unknown patterns remain under
        Unclassified.
      </p>
      <label className="mb-3 flex flex-col gap-1">
        <span className="field-label">Movement pattern breakdown week</span>
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
      {rows.length > 0 ? (
        <table
          aria-label="Work by primary movement pattern"
          className="w-full text-left text-sm"
        >
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-2">Primary movement pattern</th>
              <th scope="col" className="py-2 text-right">External volume</th>
              <th scope="col" className="py-2 text-right">Logged sets</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([movement_pattern, { volume, sets }]) => (
              <tr
                key={movement_pattern ?? "unclassified"}
                className="border-t border-line-muted"
              >
                <th scope="row" className="py-2 font-medium">
                  {movement_pattern === null
                    ? "Unclassified"
                    : MOVEMENT_PATTERN_LABELS[movement_pattern] ?? movement_pattern}
                </th>
                <td className="py-2 text-right" data-numeric>{NUMBER_FORMAT.format(volume)} kg</td>
                <td className="py-2 text-right" data-numeric>{sets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p role="status" className="text-sm text-muted">
          No gym sets recorded for this week.
        </p>
      )}
    </section>
  );
}

function WeeklyRirDistributionTable({ weeks }: { weeks: TrainingLoadWeek[] }) {
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const week = weeks.find((entry) => entry.week_start === selectedWeek) ?? weeks.at(-1);
  if (!week) return null;

  return (
    <section className="card mt-4 p-4">
      <h3 className="font-semibold">Weekly set RIR distribution</h3>
      <p className="my-2 text-sm text-muted">
        Counts show reps in reserve recorded for each logged set. Sets without a recorded RIR stay
        under Unreported.
      </p>
      <label className="mb-3 flex flex-col gap-1">
        <span className="field-label">RIR distribution week</span>
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
      {week.rir_distribution.length > 0 ? (
        <table aria-label="Weekly set RIR distribution" className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-2">Reported RIR</th>
              <th scope="col" className="py-2 text-right">Logged sets</th>
            </tr>
          </thead>
          <tbody>
            {week.rir_distribution.map(({ rir, sets }) => (
              <tr
                key={rir === null ? "unreported" : `rir-${rir}`}
                className="border-t border-line-muted"
              >
                <th scope="row" className="py-2 font-medium">
                  {rir === null ? "Unreported" : `RIR ${rir}`}
                </th>
                <td className="py-2 text-right" data-numeric>
                  {sets}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p role="status" className="text-sm text-muted">No logged sets for this week.</p>
      )}
    </section>
  );
}

function effortLoadLabel(effort: TrainingLoadWeek["session_effort"]): string {
  if (effort.load_au !== null) return `${NUMBER_FORMAT.format(effort.load_au)} AU`;
  return effort.logged_sessions ? "No ratings" : "No sessions";
}

function SessionEffortTable({ weeks }: { weeks: TrainingLoadWeek[] }) {
  return (
    <section className="card mt-4 p-4">
      <h3 className="font-semibold">Session effort</h3>
      <p className="my-2 text-sm text-muted">
        Each rated workout or activity contributes its duration in minutes × its whole-session RPE.
        The load is shown in arbitrary units (AU) with the number of sessions that had ratings.
      </p>
      <div className="overflow-x-auto">
        <table aria-label="Weekly session effort" className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-2">Week of</th>
              <th scope="col" className="px-2 py-2 text-right">Rated / logged</th>
              <th scope="col" className="px-2 py-2 text-right">Rated minutes</th>
              <th scope="col" className="py-2 text-right">Load</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map(({ week_start, session_effort: effort }) => (
              <tr key={week_start} className="border-t border-line-muted" data-numeric>
                <th scope="row" className="py-2 font-medium">{week_start}</th>
                <td className="px-2 py-2 text-right">{effort.rated_sessions} / {effort.logged_sessions}</td>
                <td className="px-2 py-2 text-right">{effort.rated_minutes}</td>
                <td className="py-2 text-right">{effortLoadLabel(effort)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WorkloadRatioCard({ weeks }: { weeks: TrainingLoadWeek[] }) {
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const latestFirst = [...weeks].reverse();
  const week = weeks.find((entry) => entry.week_start === selectedWeek)
    ?? latestFirst.find((entry) => entry.workload_ratio.status !== "week_incomplete")
    ?? latestFirst[0];
  if (!week) return null;
  const comparison = week.workload_ratio;

  return (
    <section className="card mt-4 p-4" aria-labelledby="workload-ratio-heading">
      <h3 className="font-semibold" id="workload-ratio-heading">Calendar workload ratio (ACWR)</h3>
      <p className="my-2 text-sm text-muted">
        The selected closed week's session-RPE load divided by the average of its four preceding
        Monday-start weeks. This compares recorded workload. Each of the five weeks needs logged
        sessions with complete ratings, even when the weekly table shows fewer weeks.
      </p>
      <label className="mb-3 flex flex-col gap-1">
        <span className="field-label">Comparison week</span>
        <select
          className="input w-fit"
          value={week.week_start}
          onChange={(event) => setSelectedWeek(event.target.value)}
        >
          {latestFirst.map((entry) => (
            <option key={entry.week_start} value={entry.week_start}>
              {entry.week_start}
            </option>
          ))}
        </select>
      </label>
      {comparison.baseline_start ? (
        <p className="mb-3 text-xs text-muted">
          Baseline starts {comparison.baseline_start} and ends before the week of {week.week_start}.
        </p>
      ) : null}
      {comparison.ratio !== null && comparison.baseline_mean_au !== null ? (
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Selected week</dt>
            <dd className="font-semibold" data-numeric>{effortLoadLabel(week.session_effort)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Prior four-week average</dt>
            <dd className="font-semibold" data-numeric>{BASELINE_FORMAT.format(comparison.baseline_mean_au)} AU</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Ratio</dt>
            <dd className="font-semibold" data-numeric>{comparison.ratio.toFixed(2)}×</dd>
          </div>
        </dl>
      ) : (
        <p role="status" className="text-sm text-muted">{RATIO_MESSAGES[comparison.status]}</p>
      )}
    </section>
  );
}

export function TrainingLoadView() {
  const [weekOf, setWeekOf] = useState(() => formatDate(new Date().toISOString()));
  const [weeks, setWeeks] = useState(8);
  const [exporting, setExporting] = useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const validDate = isIsoCalendarDate(weekOf);
  const params = new URLSearchParams({ week_of: weekOf, weeks: String(weeks), timezone });
  const { data, error, isPending } = useQuery({
    queryKey: ["training-load", weekOf, weeks, timezone],
    queryFn: () => apiFetch<TrainingLoadResponse>(`/training-load?${params.toString()}`),
    enabled: validDate,
  });

  async function downloadCsv() {
    setExporting(true);
    try {
      const { blob, filename } = await apiFetchBlob(`/training-load/export?${params.toString()}`);
      triggerBlobDownload(blob, filename ?? "training-load.csv");
    } catch (error) {
      toast.error(`Training export failed: ${errorMessage(error)}`);
    } finally {
      setExporting(false);
    }
  }

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
        <Button className="self-end" disabled={!validDate || exporting} onClick={() => void downloadCsv()}>
          {exporting ? "Preparing CSV…" : "Download training CSV"}
        </Button>
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
                  <td className="p-3 text-right whitespace-nowrap">{NUMBER_FORMAT.format(week.volume_kg)} kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data ? <MuscleVolumeTable weeks={data.weeks} /> : null}
      {data ? <MovementPatternVolumeTable weeks={data.weeks} /> : null}
      {data ? <WeeklyRirDistributionTable weeks={data.weeks} /> : null}
      {data ? <SessionEffortTable weeks={data.weeks} /> : null}
      {data ? <WorkloadRatioCard weeks={data.weeks} /> : null}
    </section>
  );
}
