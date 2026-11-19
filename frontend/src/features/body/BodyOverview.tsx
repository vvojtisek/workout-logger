import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { BodyMetricTrends, SleepTrends } from "@/api/types";
import { rangeStart } from "@/features/trends/series";
import { formatDate } from "@/lib/format";
import { SLEEP_QUALITY_SCALE, scaleText } from "@/lib/scales";
import { formatSleepDuration, localIsoDate } from "@/lib/today";
import { formatWeightDeltaKg, formatWeightKg } from "@/lib/units";
import { Block, PageHeading } from "@/ui";
import { BodyTrend, SleepTrend } from "./BodyTrends";
import { useBodyEntries, useSleepEntries } from "./entries";

export function BodyOverview() {
  const today = localIsoDate(new Date());
  const from = rangeStart("7", today);
  const bodyEntries = useBodyEntries(from, today);
  const sleepEntries = useSleepEntries(from, today);
  const body = useQuery({
    queryKey: ["body-metrics-trends"],
    queryFn: ({ signal }) => apiFetch<BodyMetricTrends>("/body-metrics/trends", { signal }),
  });
  const sleep = useQuery({
    queryKey: ["sleep-trends"],
    queryFn: ({ signal }) => apiFetch<SleepTrends>("/sleep-entries/trends", { signal }),
  });
  const latestWeight = body.data?.latest;
  const lastSleep = sleep.data?.latest;

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeading>Body &amp; Sleep</PageHeading>
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-primary" to="/biometrics/new">Log measurement</Link>
          <Link className="btn btn-secondary" to="/sleep/new">Log sleep</Link>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Block className="mt-3 py-4">
            <h3 className="font-semibold">Measurements</h3>
            {body.error ? <p role="alert" className="mt-2 text-sm text-danger">{errorMessage(body.error)}</p> : null}
            {body.isPending ? <p className="mt-2 text-sm text-muted">Loading measurements…</p> : null}
            {body.isSuccess && !latestWeight ? <p className="mt-2 text-sm text-muted">No measurements logged yet.</p> : null}
            {latestWeight ? (
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <div><dt className="text-sm text-muted">Latest weight</dt><dd className="text-xl font-semibold" data-numeric>{formatWeightKg(latestWeight.weight_kg)}</dd><dd className="text-xs text-muted">{formatDate(latestWeight.measured_at)}</dd></div>
                <div><dt className="text-sm text-muted">7-day change</dt><dd className="text-xl font-semibold" data-numeric>{body.data?.weight_kg_delta_7d == null ? "–" : formatWeightDeltaKg(body.data.weight_kg_delta_7d)}</dd></div>
                <div>
                  <dt className="text-sm text-muted">14-day change</dt>
                  <dd className="font-semibold" data-numeric>{body.data?.weight_kg_delta_14d == null ? "–" : formatWeightDeltaKg(body.data.weight_kg_delta_14d)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Latest body fat</dt>
                  <dd className="font-semibold" data-numeric>{latestWeight.body_fat_percent == null ? "–" : `${latestWeight.body_fat_percent.toFixed(1)}%`}</dd>
                </div>
              </dl>
            ) : null}
          </Block>
          {bodyEntries.error ? <p role="alert" className="text-sm text-danger">{errorMessage(bodyEntries.error)}</p> : null}
          {bodyEntries.data ? <BodyTrend rows={bodyEntries.data} range="7" end={today} /> : null}
        </div>
        <div>
          <Block className="mt-3 py-4">
            <h3 className="font-semibold">Sleep</h3>
            {sleep.error ? <p role="alert" className="mt-2 text-sm text-danger">{errorMessage(sleep.error)}</p> : null}
            {sleep.isPending ? <p className="mt-2 text-sm text-muted">Loading sleep…</p> : null}
            {sleep.isSuccess && !lastSleep ? <p className="mt-2 text-sm text-muted">No sleep logged yet.</p> : null}
            {lastSleep ? (
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <div><dt className="text-sm text-muted">Last time in bed</dt><dd className="text-xl font-semibold" data-numeric>{formatSleepDuration(lastSleep.time_in_bed_seconds)}</dd><dd className="text-xs text-muted">{formatDate(lastSleep.sleep_date)}</dd></div>
                <div><dt className="text-sm text-muted">7-day average sleep</dt><dd className="text-xl font-semibold" data-numeric>{sleep.data?.average_sleep_seconds_7d == null ? "–" : formatSleepDuration(sleep.data.average_sleep_seconds_7d)}</dd></div>
                <div>
                  <dt className="text-sm text-muted">30-day average sleep</dt>
                  <dd className="font-semibold">{sleep.data?.average_sleep_seconds_30d == null ? "–" : formatSleepDuration(sleep.data.average_sleep_seconds_30d)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">7-day average quality</dt>
                  <dd className="font-semibold">{sleep.data?.average_quality_score_7d == null ? "–" : scaleText(SLEEP_QUALITY_SCALE, Number(sleep.data.average_quality_score_7d.toFixed(1)))}</dd>
                </div>
              </dl>
            ) : null}
          </Block>
          {sleepEntries.error ? <p role="alert" className="text-sm text-danger">{errorMessage(sleepEntries.error)}</p> : null}
          {sleepEntries.data ? <SleepTrend rows={sleepEntries.data} range="7" end={today} /> : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link className="btn btn-secondary" to="/body/trends">See all body and sleep trends</Link>
        <Link className="btn btn-secondary" to="/biometrics">View measurements</Link>
        <Link className="btn btn-secondary" to="/sleep">View sleep entries</Link>
      </div>
    </section>
  );
}
