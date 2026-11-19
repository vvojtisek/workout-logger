import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import { ClockInput } from "@/ui/ClockInput";
import type { Paginated, WorkoutLog } from "@/api/types";
import { RECOVERY_TYPES, activityLabel, logSummaryFacts, logTitle } from "@/lib/activity";
import type { RecoveryType } from "@/lib/activity";
import { formatTime } from "@/lib/format";
import {
  RECOVERY_DURATION_PRESETS,
  applyPrefill,
  dayChoices,
  defaultsFor,
  defaultsPath,
  durationChoices,
  newQuickForm,
  nowSlot,
  presetBody,
  quickActivityBody,
  rankedTypes,
  timeChoices,
} from "@/lib/quick-activity";
import type { ActivityDefaults, LinkCandidate, QuickField, QuickForm, RecoveryPreset } from "@/lib/quick-activity";
import { deviceTimezone, localIsoDate } from "@/lib/today";
import { Button, PageHeading } from "@/ui";

import { ACTIVITY_DEFAULTS_KEY, announceSaved, postActivity } from "./CardioLogView";
import { ChipGroup, Stepper } from "./QuickChips";

const RECOVERY_KEY = ["recovery-today"] as const;
const CYCLE_TYPES: RecoveryType[] = ["sauna", "cold_plunge"];

function candidateLabel(candidate: LinkCandidate): string {
  const name = candidate.activity_type ? activityLabel(candidate.activity_type) : (candidate.name ?? "Workout");
  return `After ${name} ${formatTime(candidate.performed_at)}`;
}

function startOfLocalDay(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/** Recovery: one-tap cards for the routines you repeat (each logs now and is
 * linked to the session just before it), and a short form for anything else. */
export function RecoveryLogView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [now] = useState(() => new Date());
  const timezone = deviceTimezone();
  const today = localIsoDate(now);
  const [form, setForm] = useState<QuickForm<RecoveryType>>(() => newQuickForm<RecoveryType>("sauna", now));
  const touched = useRef(new Set<QuickField>());
  const [error, setError] = useState<string | null>(null);

  const defaults = useQuery({
    queryKey: [...ACTIVITY_DEFAULTS_KEY, "recovery", form.day, timezone],
    queryFn: () => apiFetch<ActivityDefaults>(defaultsPath("recovery", form.day, timezone)),
  });
  const todayDefaults = useQuery({
    queryKey: [...ACTIVITY_DEFAULTS_KEY, "recovery", today, timezone],
    queryFn: () => apiFetch<ActivityDefaults>(defaultsPath("recovery", today, timezone)),
  });
  const loggedToday = useQuery({
    queryKey: [...RECOVERY_KEY, today],
    queryFn: () =>
      apiFetch<Paginated<WorkoutLog>>(
        `/logs?category=recovery&limit=20&date_from=${encodeURIComponent(startOfLocalDay(now))}`,
      ),
  });
  const data = defaults.data;
  const candidates = data?.link_candidates ?? [];

  useEffect(() => {
    if (data) setForm((current) => applyPrefill(current, data, touched.current, RECOVERY_TYPES, nowSlot(now)));
  }, [data, now]);

  function touch(field: QuickField, change: Partial<QuickForm<RecoveryType>>) {
    touched.current.add(field);
    setForm((current) => {
      const next = { ...current, ...change };
      return field === "type" && data ? applyPrefill(next, data, touched.current, RECOVERY_TYPES, nowSlot(now)) : next;
    });
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: RECOVERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ACTIVITY_DEFAULTS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["today"] });
  }

  const tap = useMutation({
    mutationFn: (preset: RecoveryPreset) => postActivity(presetBody(preset, new Date())),
    onSuccess: (result, preset) => {
      refresh();
      announceSaved(result, preset.label, (path) => void navigate(path), refresh);
    },
    onError: (err, preset) => {
      setError(`Failed to log ${preset.label}: ${errorMessage(err)}`);
    },
  });

  const save = useMutation({
    mutationFn: postActivity,
    onSuccess: (result) => {
      refresh();
      announceSaved(result, activityLabel(form.type), (path) => void navigate(path), refresh);
    },
    onError: (err) => setError(`Failed to save: ${errorMessage(err)}`),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const usesCycles = CYCLE_TYPES.includes(form.type);
    // The link chip shown as chosen is the one saved.
    const shownLink = form.linkedLogId === "auto" ? (candidates.at(-1)?.id ?? "auto") : form.linkedLogId;
    const sent = { ...form, linkedLogId: shownLink };
    const result = quickActivityBody(usesCycles ? sent : { ...sent, cycles: null, cycleMinutes: null }, {
      requireEffort: false,
    });
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setError(null);
    save.mutate(result.body);
  }

  const presets = todayDefaults.data?.presets ?? [];
  const todaysLink = todayDefaults.data?.link_candidates.at(-1);
  const prediction = defaultsFor(data, form.type);
  const days = dayChoices(now);
  const times = timeChoices(data, prediction?.start_time ?? null, nowSlot(now));
  const durations = durationChoices(RECOVERY_DURATION_PRESETS, prediction?.duration_minutes ?? null);
  const usesCycles = CYCLE_TYPES.includes(form.type);

  return (
    <section id="recovery-log-view">
      <PageHeading hint="One tap logs a routine now. It is linked to the session you just finished.">
        Log recovery
      </PageHeading>

      <div className="mb-6 grid grid-cols-2 gap-2" data-testid="recovery-presets">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            data-testid="recovery-preset"
            disabled={tap.isPending}
            onClick={() => tap.mutate(preset)}
            className="flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-[var(--radius-md)] border border-line bg-elevated px-3 py-2 text-left active:bg-accent-soft"
          >
            <span className="text-sm leading-tight font-semibold">{preset.label}</span>
            <span data-numeric className="text-[11px] leading-tight text-muted">
              {preset.duration_minutes} min{todaysLink ? ` · ${candidateLabel(todaysLink).toLowerCase()}` : ""}
            </span>
          </button>
        ))}
      </div>

      {(loggedToday.data?.items.length ?? 0) > 0 ? (
        <section aria-label="Recovery logged today" className="mb-6 flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-muted">Logged today</h2>
          <ul className="flex flex-col divide-y divide-line-muted" data-testid="recovery-today">
            {loggedToday.data?.items.map((log) => (
              <li key={log.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="font-semibold">{logTitle(log)}</span>
                <span data-numeric className="text-muted">
                  {formatTime(log.performed_at)} · {logSummaryFacts(log).slice(0, 2).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="recovery-form" aria-busy={defaults.isFetching}>
        <h2 className="text-base font-semibold">Something else</h2>
        <ChipGroup
          label="Recovery"
          testId="recovery-type"
          options={rankedTypes(data, RECOVERY_TYPES).map((type) => ({
            value: type,
            label: activityLabel(type),
            predicted: type === data?.suggested.activity_type,
          }))}
          value={form.type}
          onChange={(type) => type && touch("type", { type })}
        />
        <ChipGroup
          label="Day"
          testId="recovery-day"
          options={days}
          value={days.some((day) => day.value === form.day) ? form.day : null}
          onChange={(day) => day && setForm((current) => ({ ...current, day }))}
        />
        <ChipGroup
          label="Started"
          testId="recovery-time"
          options={times.map((time) => ({ value: time, label: time, predicted: time === prediction?.start_time }))}
          value={times.includes(form.time) ? form.time : null}
          onChange={(time) => time && touch("time", { time })}
        >
          <div className="w-32">
            <ClockInput label="Start time" required value={form.time} onChange={(time) => touch("time", { time })} />
          </div>
        </ChipGroup>
        {usesCycles ? (
          <>
            <Stepper
              label="Cycles"
              unit="cycles"
              min={1}
              max={20}
              value={form.cycles ?? 1}
              onChange={(cycles) => {
                const minutes = form.cycleMinutes;
                touch("cycles", minutes ? { cycles, duration: cycles * minutes } : { cycles });
              }}
            />
            <Stepper
              label="Minutes per cycle"
              unit="min"
              min={1}
              max={60}
              value={form.cycleMinutes ?? (form.type === "sauna" ? 12 : 2)}
              onChange={(cycleMinutes) =>
                touch("cycles", { cycleMinutes, duration: (form.cycles ?? 1) * cycleMinutes })
              }
            />
          </>
        ) : null}
        <ChipGroup
          label="Total duration"
          testId="recovery-duration"
          options={durations.map((minutes) => ({
            value: minutes,
            label: `${minutes}m`,
            predicted: minutes === prediction?.duration_minutes,
          }))}
          value={durations.includes(form.duration) ? form.duration : null}
          onChange={(duration) => duration && touch("duration", { duration })}
        >
          <input
            type="number"
            inputMode="numeric"
            aria-label="Duration in minutes"
            min={1}
            max={600}
            className="input min-h-11 w-20"
            value={Number.isFinite(form.duration) ? form.duration : ""}
            onChange={(event) => touch("duration", { duration: Number.parseInt(event.target.value, 10) })}
          />
        </ChipGroup>
        {candidates.length > 0 ? (
          <ChipGroup
            label="Linked to"
            testId="recovery-link"
            options={[
              ...candidates.map((candidate) => ({ value: candidate.id, label: candidateLabel(candidate) })),
              { value: "none", label: "Nothing" },
            ]}
            value={form.linkedLogId === null ? "none" : form.linkedLogId === "auto" ? (candidates.at(-1)?.id ?? null) : form.linkedLogId}
            onChange={(choice) =>
              choice && setForm((current) => ({ ...current, linkedLogId: choice === "none" ? null : choice }))
            }
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button touch variant="primary" type="submit" disabled={save.isPending}>
          Save {activityLabel(form.type).toLowerCase()}
        </Button>
      </form>
    </section>
  );
}
