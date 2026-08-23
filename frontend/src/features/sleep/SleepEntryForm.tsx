import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { SleepEntry } from "@/api/types";
import { sleepEntryPayloadSchema } from "@/lib/sleep-entry-schema";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

interface FieldState {
  sleep_start: string;
  sleep_end: string;
  timezone: string;
  estimated_sleep_minutes: string;
  awake_minutes: string;
  quality_score: string;
  resting_heart_rate: string;
  notes: string;
}

function emptyFields(): FieldState {
  return {
    sleep_start: "",
    sleep_end: "",
    timezone: defaultTimezone(),
    estimated_sleep_minutes: "",
    awake_minutes: "",
    quality_score: "",
    resting_heart_rate: "",
    notes: "",
  };
}

function fieldsFromEntry(entry: SleepEntry): FieldState {
  return {
    sleep_start: toDatetimeLocal(entry.sleep_start),
    sleep_end: toDatetimeLocal(entry.sleep_end),
    timezone: entry.timezone,
    estimated_sleep_minutes:
      entry.estimated_sleep_seconds != null ? String(Math.round(entry.estimated_sleep_seconds / 60)) : "",
    awake_minutes: entry.awake_seconds != null ? String(Math.round(entry.awake_seconds / 60)) : "",
    quality_score: entry.quality_score != null ? String(entry.quality_score) : "",
    resting_heart_rate: entry.resting_heart_rate != null ? String(entry.resting_heart_rate) : "",
    notes: entry.notes ?? "",
  };
}

function buildPayload(fields: FieldState) {
  return {
    sleep_start: fields.sleep_start ? new Date(fields.sleep_start).toISOString() : "",
    sleep_end: fields.sleep_end ? new Date(fields.sleep_end).toISOString() : "",
    timezone: fields.timezone.trim(),
    estimated_sleep_seconds: fields.estimated_sleep_minutes.trim()
      ? Number.parseInt(fields.estimated_sleep_minutes, 10) * 60
      : null,
    awake_seconds: fields.awake_minutes.trim()
      ? Number.parseInt(fields.awake_minutes, 10) * 60
      : null,
    quality_score: fields.quality_score.trim() ? Number.parseInt(fields.quality_score, 10) : null,
    resting_heart_rate: fields.resting_heart_rate.trim()
      ? Number.parseInt(fields.resting_heart_rate, 10)
      : null,
    notes: fields.notes.trim() || null,
    source: "manual",
  };
}

export function SleepEntryForm() {
  const { entryId } = useParams<{ entryId: string }>();
  const isEditing = Boolean(entryId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [fields, setFields] = useState<FieldState>(emptyFields);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seededEntryId = useRef<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["sleep-entry", entryId],
    queryFn: () => apiFetch<SleepEntry>(`/sleep-entries/${entryId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existing || seededEntryId.current === existing.id) return;
    seededEntryId.current = existing.id;
    setFields(fieldsFromEntry(existing));
  }, [existing]);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing
        ? apiFetch<SleepEntry>(`/sleep-entries/${entryId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : apiFetch<SleepEntry>("/sleep-entries", {
            method: "POST",
            body: JSON.stringify(payload),
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sleep-entries"] });
      toast.success(isEditing ? "Updated entry" : "Logged entry");
      void navigate("/sleep");
    },
    onError: (err: unknown) => toast.error(`Failed to save: ${errorMessage(err)}`),
  });

  function update(key: keyof FieldState, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    const payload = buildPayload(fields);
    const result = sleepEntryPayloadSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        nextErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(nextErrors);
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  if (isEditing && isLoading) {
    return (
      <section id="sleep-form-view">
        <PageHeading>{isEditing ? "Edit Sleep Entry" : "Log Sleep"}</PageHeading>
        <p className="text-sm text-muted">Loading entry…</p>
      </section>
    );
  }

  return (
    <section id="sleep-form-view">
      <PageHeading>{isEditing ? "Edit Sleep Entry" : "Log Sleep"}</PageHeading>

      <Card className="flex flex-col gap-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="sleep-start">
              Went to bed
            </label>
            <Input
              id="sleep-start"
              type="datetime-local"
              value={fields.sleep_start}
              onChange={(e) => update("sleep_start", e.target.value)}
            />
            {errors.sleep_start ? (
              <p className="mt-1 text-sm text-danger">{errors.sleep_start}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="sleep-end">
              Woke up
            </label>
            <Input
              id="sleep-end"
              type="datetime-local"
              value={fields.sleep_end}
              onChange={(e) => update("sleep_end", e.target.value)}
            />
            {errors.sleep_end ? (
              <p className="mt-1 text-sm text-danger">{errors.sleep_end}</p>
            ) : null}
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="sleep-timezone">
            Timezone
          </label>
          <Input
            id="sleep-timezone"
            placeholder="e.g. America/New_York"
            value={fields.timezone}
            onChange={(e) => update("timezone", e.target.value)}
          />
          {errors.timezone ? <p className="mt-1 text-sm text-danger">{errors.timezone}</p> : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="sleep-estimated">
              Estimated sleep (minutes, optional)
            </label>
            <Input
              id="sleep-estimated"
              type="number"
              value={fields.estimated_sleep_minutes}
              onChange={(e) => update("estimated_sleep_minutes", e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="sleep-awake">
              Time awake (minutes, optional)
            </label>
            <Input
              id="sleep-awake"
              type="number"
              value={fields.awake_minutes}
              onChange={(e) => update("awake_minutes", e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="sleep-quality">
              Quality (1–5, optional)
            </label>
            <Input
              id="sleep-quality"
              type="number"
              min="1"
              max="5"
              value={fields.quality_score}
              onChange={(e) => update("quality_score", e.target.value)}
            />
            {errors.quality_score ? (
              <p className="mt-1 text-sm text-danger">{errors.quality_score}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="sleep-heart-rate">
              Resting heart rate (bpm, optional)
            </label>
            <Input
              id="sleep-heart-rate"
              type="number"
              value={fields.resting_heart_rate}
              onChange={(e) => update("resting_heart_rate", e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="sleep-notes">
            Notes (optional)
          </label>
          <textarea
            id="sleep-notes"
            className="input"
            rows={2}
            value={fields.notes}
            onChange={(e) => update("notes", e.target.value)}
          />
        </div>
      </Card>

      <div className="mt-5 flex gap-2">
        <Button
          id="save-sleep-entry-btn"
          variant="primary"
          disabled={mutation.isPending}
          onClick={submit}
        >
          {isEditing ? "Save changes" : "Log sleep"}
        </Button>
        <Button onClick={() => void navigate("/sleep")}>Cancel</Button>
      </div>
    </section>
  );
}
