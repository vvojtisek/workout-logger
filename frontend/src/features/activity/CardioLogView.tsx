import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { WorkoutLog } from "@/api/types";
import { CARDIO_TYPES, activityLabel } from "@/lib/activity";
import type { CardioType } from "@/lib/activity";
import {
  DURATION_PRESETS,
  applyPrefill,
  dayChoices,
  defaultsFor,
  defaultsPath,
  durationChoices,
  newQuickForm,
  nowSlot,
  quickActivityBody,
  rankedTypes,
  timeChoices,
} from "@/lib/quick-activity";
import type { ActivityDefaults, CoachActivityBody, QuickField, QuickForm } from "@/lib/quick-activity";
import { BODY_FEEL_SCALE, EFFORT_LEVEL_SCALE, scaleValues } from "@/lib/scales";
import { deviceTimezone } from "@/lib/today";
import { toast } from "@/ui/Toast";
import { Button, Input, PageHeading } from "@/ui";

import { ChipGroup, QuickLogTabs } from "./QuickChips";

export interface CoachLogResult {
  workout_log: WorkoutLog | null;
  merged_into_existing: boolean;
}

export const ACTIVITY_DEFAULTS_KEY = ["activity-defaults"] as const;
const UNDO_TOAST_MS = 8000;

/** Undo removes a log this tap created; a watch session it only filled in
 * stays, so the toast then offers Edit alone. */
export function announceSaved(
  result: CoachLogResult,
  label: string,
  navigate: (path: string) => void,
  onUndone: () => void,
) {
  const saved = result.workout_log;
  if (!saved) return;
  const edit = { label: "Edit", onClick: () => navigate(`/history/${saved.id}?edit=1`) };
  if (result.merged_into_existing) {
    toast.success(`${label} added to the watch session`, { durationMs: UNDO_TOAST_MS, action: edit });
    return;
  }
  toast.success(`${label} logged`, {
    durationMs: UNDO_TOAST_MS,
    action: {
      label: "Undo",
      onClick: () => {
        apiFetch(`/logs/${saved.id}`, { method: "DELETE" })
          .then(() => {
            toast(`${label} removed`);
            onUndone();
          })
          .catch((err: unknown) => toast.error(`Failed to undo: ${errorMessage(err)}`));
      },
    },
    secondaryAction: edit,
  });
}

export function postActivity(activity: CoachActivityBody): Promise<CoachLogResult> {
  return apiFetch<CoachLogResult>("/coach/log", { method: "POST", body: JSON.stringify({ activity }) });
}

/** Cardio and sport after the fact: activity, day, start, duration and a
 * required 1-5 effort, all pre-filled from the same weekday in recent weeks,
 * plus optional before/after feel. Every chip is one tap to override. */
export function CardioLogView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [now] = useState(() => new Date());
  const timezone = deviceTimezone();
  const [form, setForm] = useState<QuickForm<CardioType>>(() => newQuickForm<CardioType>("ice_hockey", now));
  const touched = useRef(new Set<QuickField>());
  const [error, setError] = useState<string | null>(null);

  const defaults = useQuery({
    queryKey: [...ACTIVITY_DEFAULTS_KEY, "cardio", form.day, timezone],
    queryFn: () => apiFetch<ActivityDefaults>(defaultsPath("cardio", form.day, timezone)),
  });
  const data = defaults.data;

  useEffect(() => {
    if (data) setForm((current) => applyPrefill(current, data, touched.current, CARDIO_TYPES, nowSlot(now)));
  }, [data, now]);

  function touch(field: QuickField, change: Partial<QuickForm<CardioType>>) {
    touched.current.add(field);
    setForm((current) => {
      const next = { ...current, ...change };
      // A new activity brings its own usual time, duration and effort.
      return field === "type" && data ? applyPrefill(next, data, touched.current, CARDIO_TYPES, nowSlot(now)) : next;
    });
  }

  const save = useMutation({
    mutationFn: postActivity,
    onSuccess: (result) => {
      const label = form.type === "other" && form.name.trim() ? form.name.trim() : activityLabel(form.type);
      void queryClient.invalidateQueries({ queryKey: ACTIVITY_DEFAULTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      announceSaved(result, label, (path) => void navigate(path), () => {
        void queryClient.invalidateQueries({ queryKey: ["today"] });
      });
      void navigate("/history");
    },
    onError: (err) => setError(`Failed to save: ${errorMessage(err)}`),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = quickActivityBody(form, { requireEffort: true });
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setError(null);
    save.mutate(result.body);
  }

  const prediction = defaultsFor(data, form.type);
  const predictedType = data?.suggested.activity_type;
  const days = dayChoices(now);
  const times = timeChoices(data, prediction?.start_time ?? null, nowSlot(now));
  const durations = durationChoices(DURATION_PRESETS, prediction?.duration_minutes ?? null);

  return (
    <section id="cardio-log-view">
      <PageHeading hint="Pre-filled from what you usually do on this weekday. Tap anything to change it.">
        Log cardio
      </PageHeading>
      <QuickLogTabs />
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="cardio-form" aria-busy={defaults.isFetching}>
        <ChipGroup
          label="Activity"
          testId="cardio-type"
          options={rankedTypes(data, CARDIO_TYPES).map((type) => ({
            value: type,
            label: activityLabel(type).replace(" activity", ""),
            predicted: type === predictedType,
          }))}
          value={form.type}
          onChange={(type) => type && touch("type", { type })}
        />
        {form.type === "other" ? (
          <div>
            <label className="field-label" htmlFor="cardio-name">
              What was it? (optional)
            </label>
            <Input
              id="cardio-name"
              maxLength={60}
              placeholder="Paddleboarding"
              value={form.name}
              onChange={(event) => touch("name", { name: event.target.value })}
            />
          </div>
        ) : null}

        <ChipGroup
          label="Day"
          testId="cardio-day"
          options={days}
          value={days.some((day) => day.value === form.day) ? form.day : null}
          onChange={(day) => day && setForm((current) => ({ ...current, day }))}
        >
          <input
            type="date"
            aria-label="Another day"
            className="input min-h-11 w-auto"
            max={days[0].value}
            value={form.day}
            onChange={(event) => event.target.value && setForm((current) => ({ ...current, day: event.target.value }))}
          />
        </ChipGroup>

        <ChipGroup
          label="Started"
          testId="cardio-time"
          options={times.map((time) => ({ value: time, label: time, predicted: time === prediction?.start_time }))}
          value={times.includes(form.time) ? form.time : null}
          onChange={(time) => time && touch("time", { time })}
        >
          <input
            type="time"
            aria-label="Start time"
            step={300}
            className="input min-h-11 w-auto"
            value={form.time}
            onChange={(event) => event.target.value && touch("time", { time: event.target.value })}
          />
        </ChipGroup>

        <ChipGroup
          label="Duration"
          testId="cardio-duration"
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

        <ChipGroup
          label="Effort"
          testId="cardio-effort"
          hint="1 relaxed · 3 standard · 5 max"
          options={scaleValues(EFFORT_LEVEL_SCALE).map((level) => ({
            value: level,
            label: `${level} ${EFFORT_LEVEL_SCALE.labels[level]}`,
            predicted: level === prediction?.effort_level,
          }))}
          value={form.effort}
          onChange={(effort) => effort && touch("effort", { effort })}
        />

        <ChipGroup
          label="Before (optional)"
          testId="cardio-feel-before"
          clearable
          options={scaleValues(BODY_FEEL_SCALE).map((value) => ({ value, label: BODY_FEEL_SCALE.labels[value] }))}
          value={form.feelBefore}
          onChange={(feelBefore) => setForm((current) => ({ ...current, feelBefore }))}
        />
        <ChipGroup
          label="After (optional)"
          testId="cardio-feel-after"
          clearable
          options={scaleValues(BODY_FEEL_SCALE).map((value) => ({ value, label: BODY_FEEL_SCALE.labels[value] }))}
          value={form.feelAfter}
          onChange={(feelAfter) => setForm((current) => ({ ...current, feelAfter }))}
        />

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button touch variant="primary" type="submit" disabled={save.isPending}>
            Save {form.type === "other" ? "activity" : activityLabel(form.type).toLowerCase()}
          </Button>
          <Link to="/activity/new" className="self-start text-sm text-muted underline underline-offset-2">
            Distance, notes or calories? Use the full form
          </Link>
        </div>
      </form>
    </section>
  );
}
