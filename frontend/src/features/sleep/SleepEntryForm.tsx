import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useEntryDates } from "@/features/trends/EntryDateFilter";
import { apiFetch, errorMessage } from "@/api/client";
import type { SleepEntry } from "@/api/types";
import { localDateTimeInputToIso, toLocalDateTimeInput } from "@/lib/date-time-inputs";
import { SLEEP_QUALITY_SCALE, scaleLabel, scaleOptionText, scaleValues } from "@/lib/scales";
import { sleepEntryPayloadSchema, type SleepEntryPayload } from "@/lib/sleep-entry-schema";
import { deviceTimezone, formatSleepDuration, sleepDefaults, sleepWindow } from "@/lib/today";
import { Button, Block, Input, PageHeading } from "@/ui";
import { DateTimeFields } from "@/ui/DateTimeFields";
import { MeasurementControl } from "@/ui/MeasurementControl";
import { toast } from "@/ui/Toast";

const readings = [
  { key: "estimated_sleep_seconds", label: "Estimated sleep (min)", unit: 60, min: 0, max: 1440 },
  { key: "awake_seconds", label: "Time awake (min)", unit: 60, min: 0, max: 1440 },
  { key: "resting_heart_rate", label: "Resting heart rate (bpm)", unit: 1, min: 20, max: 250 },
] as const;
type ReadingKey = (typeof readings)[number]["key"];
type Defaults = Pick<SleepEntry, ReadingKey> & {
  sleep_start: string | null;
  sleep_end: string | null;
};

function initialWindow(entry?: SleepEntry, previous?: Defaults) {
  if (entry)
    return {
      start: toLocalDateTimeInput(entry.sleep_start),
      end: toLocalDateTimeInput(entry.sleep_end),
    };
  const { bedMinutes, wakeMinutes } = sleepDefaults(
    previous?.sleep_start && previous.sleep_end
      ? { sleep_start: previous.sleep_start, sleep_end: previous.sleep_end }
      : null,
  );
  const { start, end } = sleepWindow(new Date(), bedMinutes, wakeMinutes);
  return { start: toLocalDateTimeInput(start), end: toLocalDateTimeInput(end) };
}

export function SleepEntryForm() {
  const { entryId } = useParams<{ entryId: string }>();
  const existing = useQuery({
    queryKey: ["sleep-entry", entryId],
    queryFn: () => apiFetch<SleepEntry>(`/sleep-entries/${entryId}`),
    enabled: !!entryId,
  });
  const defaults = useQuery({
    queryKey: ["sleep-entries", "entry-defaults"],
    queryFn: () => apiFetch<Defaults>("/sleep-entries/entry-defaults"),
    enabled: !entryId,
    gcTime: 0,
  });
  return (
    <section id="sleep-form-view">
      <PageHeading>{entryId ? "Edit Sleep Entry" : "Log Sleep"}</PageHeading>
      {(entryId ? existing : defaults).isLoading ? (
        <p>Loading sleep entry…</p>
      ) : entryId && !existing.data ? (
        <p role="alert">Could not load this sleep entry.</p>
      ) : (
        <>
          {!entryId && defaults.isError && (
            <p role="status">
              Previous readings are unavailable. You can enter this night manually.
            </p>
          )}
          <NightForm
            key={entryId ?? "new"}
            entry={existing.data}
            defaults={entryId ? existing.data : defaults.data}
          />
        </>
      )}
    </section>
  );
}

function NightForm({ entry, defaults }: { entry?: SleepEntry; defaults?: Defaults }) {
  const navigate = useNavigate();
  const { suffix } = useEntryDates();
  const queryClient = useQueryClient();
  const [night, setNight] = useState(() => initialWindow(entry, defaults));
  const [quality, setQuality] = useState(entry?.quality_score ?? null);
  const [timezone, setTimezone] = useState(entry?.timezone ?? deviceTimezone());
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [expanded, setExpanded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      readings.map(({ key, unit }) => {
        const value = defaults?.[key];
        return [key, value == null ? "" : String(Math.round(value / unit))];
      }),
    ),
  );
  const [included, setIncluded] = useState(() =>
    Object.fromEntries(readings.map(({ key }) => [key, entry?.[key] != null])),
  );
  const start = localDateTimeInputToIso(night.start, entry?.sleep_start);
  const end = localDateTimeInputToIso(night.end, entry?.sleep_end);
  const duration = (Date.parse(end) - Date.parse(start)) / 1000;
  const mutation = useMutation({
    mutationFn: (payload: SleepEntryPayload) =>
      apiFetch<SleepEntry>(entry ? `/sleep-entries/${entry.id}` : "/sleep-entries", {
        method: entry ? "PUT" : "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["sleep-entry", saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ["sleep-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["sleep-trends"] });
      void queryClient.invalidateQueries({ queryKey: ["today"] });
      toast.success(entry ? "Updated entry" : "Logged entry");
      void navigate(`/sleep${suffix}`);
    },
    onError: (err: unknown) => toast.error(`Failed to save: ${errorMessage(err)}`),
  });

  function submit() {
    const measurements = Object.fromEntries(
      readings.map(({ key, unit }) => {
        if (!included[key] || values[key] === "") return [key, null];
        const original = entry?.[key];
        // Imported durations can contain seconds beyond the displayed whole minute.
        const value =
          original != null && String(Math.round(original / unit)) === values[key]
            ? original
            : Number(values[key]) * unit;
        return [key, value];
      }),
    );
    const result = sleepEntryPayloadSchema.safeParse({
      ...measurements,
      sleep_start: start,
      sleep_end: end,
      timezone: timezone.trim(),
      quality_score: quality,
      notes: notes.trim() || null,
      source: entry?.source ?? "manual",
    });
    if (!result.success) {
      const next = Object.fromEntries(
        result.error.issues.map((issue) => [issue.path[0], issue.message]),
      );
      setErrors(next);
      if (readings.some(({ key }) => key in next) || next.timezone || next.notes) setExpanded(true);
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setErrors({});
    mutation.mutate(result.data);
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Block className="grid gap-3 py-3">
        <DateTimeFields
          legend="Went to bed"
          labelPrefix="Bedtime"
          value={night.start}
          onChange={(start) => setNight({ ...night, start })}
          error={errors.sleep_start}
        />
        <DateTimeFields
          legend="Woke up"
          labelPrefix="Wake"
          value={night.end}
          onChange={(end) => setNight({ ...night, end })}
          error={errors.sleep_end}
        />
        <p className="flex items-baseline justify-between text-sm text-muted">
          Time in bed
          <output className="font-semibold tabular-nums text-main">
            {duration > 0 ? formatSleepDuration(duration) : "—"}
          </output>
        </p>
      </Block>
      <Block className="py-3">
        <fieldset>
          <legend className="field-label">Sleep quality</legend>
          <div className="grid grid-cols-5 gap-1">
            {scaleValues(SLEEP_QUALITY_SCALE).map((score) => (
              <button
                key={score}
                type="button"
                aria-label={scaleOptionText(SLEEP_QUALITY_SCALE, score)}
                aria-pressed={quality === score}
                onClick={() => setQuality(quality === score ? null : score)}
                className={`rounded-md border px-0.5 py-1.5 ${quality === score ? "border-accent bg-accent-soft" : "border-line bg-elevated"}`}
              >
                <span className="block font-semibold">{score}</span>
                <span className="block text-[10px]">{scaleLabel(SLEEP_QUALITY_SCALE, score)}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </Block>
      <Block>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="sleep-details"
          onClick={() => setExpanded(!expanded)}
          className="flex min-h-12 w-full items-center justify-between font-semibold"
        >
          Sleep details{" "}
          <ChevronDown aria-hidden size={18} className={expanded ? "rotate-180" : ""} />
        </button>
        <div hidden={!expanded} id="sleep-details">
          <p className="text-xs text-muted">Check or adjust the readings you took.</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 py-2">
            {readings.map(({ key, label, min, max }) => (
              <MeasurementControl
                key={key}
                name={key}
                label={label}
                min={min}
                max={max}
                step={1}
                error={errors[key]}
                value={values[key]}
                included={included[key]}
                onInclude={(take) => setIncluded({ ...included, [key]: take })}
                onChange={(value) => {
                  setValues({ ...values, [key]: value });
                  setIncluded({ ...included, [key]: value !== "" });
                }}
              />
            ))}
          </div>
          <label htmlFor="sleep-notes" className="field-label">
            Notes (optional)
          </label>
          <textarea
            className="input"
            id="sleep-notes"
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <label htmlFor="sleep-timezone" className="field-label mt-2">
            Timezone
          </label>
          <Input
            id="sleep-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-describedby="sleep-zone-help"
          />
          <p id="sleep-zone-help" className="mt-1 text-xs text-muted">
            Used for the wake-up date in history. Times above use {deviceTimezone()}.
          </p>
          {errors.timezone && <p className="text-sm text-danger">{errors.timezone}</p>}
        </div>
      </Block>
      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          id="save-sleep-entry-btn"
          variant="primary"
          disabled={mutation.isPending}
        >
          {entry ? "Save changes" : "Log sleep"}
        </Button>
        <Button onClick={() => void navigate(`/sleep${suffix}`)}>Cancel</Button>
      </div>
    </form>
  );
}
