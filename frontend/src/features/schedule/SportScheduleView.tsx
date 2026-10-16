import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { LoadEvent, LoadEventKind, Paginated } from "@/api/types";
import { LOAD_EVENT_KINDS } from "@/api/types";
import { formatDate } from "@/lib/format";
import {
  LOAD_EVENT_KIND_LABELS,
  type LoadEventDraft,
  describeLoadEvent,
  draftFromLoadEvent,
  draftIsDirty,
  draftToPayload,
  emptyDraft,
} from "@/lib/load-events";
import { WEEKDAY_LABELS } from "@/lib/program-templates";
import { Button, Card, EmptyState, Input, PageHeading } from "@/ui";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";

const LOAD_EVENTS_KEY = ["load-events"];

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: LOAD_EVENTS_KEY });
  void queryClient.invalidateQueries({ queryKey: ["calendar"] });
}

function LoadEventFields({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string;
  draft: LoadEventDraft;
  onChange: (draft: LoadEventDraft) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2">
        <label className="field-label" htmlFor={`${idPrefix}-name`}>
          Name
        </label>
        <Input
          id={`${idPrefix}-name`}
          placeholder="e.g. League game"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </div>
      <div>
        <label className="field-label" htmlFor={`${idPrefix}-kind`}>
          Kind
        </label>
        <select
          id={`${idPrefix}-kind`}
          className="input"
          value={draft.kind}
          onChange={(event) => onChange({ ...draft, kind: event.target.value as LoadEventKind })}
        >
          {LOAD_EVENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {LOAD_EVENT_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor={`${idPrefix}-weekday`}>
          Day
        </label>
        <select
          id={`${idPrefix}-weekday`}
          className="input"
          value={draft.weekday}
          onChange={(event) => onChange({ ...draft, weekday: Number(event.target.value) })}
        >
          {WEEKDAY_LABELS.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label" htmlFor={`${idPrefix}-time`}>
          Start time
        </label>
        <Input
          id={`${idPrefix}-time`}
          inputMode="numeric"
          placeholder="e.g. 19:30"
          value={draft.startTime}
          onChange={(event) => onChange({ ...draft, startTime: event.target.value })}
        />
      </div>
      <div>
        <label className="field-label" htmlFor={`${idPrefix}-minutes`}>
          Minutes
        </label>
        <Input
          id={`${idPrefix}-minutes`}
          inputMode="numeric"
          value={draft.minutes}
          onChange={(event) => onChange({ ...draft, minutes: event.target.value })}
        />
      </div>
      <div>
        <label className="field-label" htmlFor={`${idPrefix}-season-start`}>
          Season starts
        </label>
        <Input
          id={`${idPrefix}-season-start`}
          type="date"
          value={draft.seasonStart}
          onChange={(event) => onChange({ ...draft, seasonStart: event.target.value })}
        />
      </div>
      <div>
        <label className="field-label" htmlFor={`${idPrefix}-season-end`}>
          Season ends
        </label>
        <Input
          id={`${idPrefix}-season-end`}
          type="date"
          value={draft.seasonEnd}
          onChange={(event) => onChange({ ...draft, seasonEnd: event.target.value })}
        />
      </div>
    </div>
  );
}

function LoadEventCard({ event, onDelete }: { event: LoadEvent; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => draftFromLoadEvent(event));
  const [error, setError] = useState<string | null>(null);
  const dirty = draftIsDirty(draft, event);

  const save = useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch<LoadEvent>(`/load-events/${event.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (saved) => {
      setDraft(draftFromLoadEvent(saved));
      setError(null);
      toast.success(`Saved "${saved.name}"`);
      invalidate(queryClient);
    },
    onError: (err: unknown) => setError(`Failed to save: ${errorMessage(err)}`),
  });

  function submit() {
    const result = draftToPayload(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    save.mutate(result.payload);
  }

  return (
    <li>
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-medium">
            {event.name}{" "}
            <span className="text-sm font-normal text-muted">
              {LOAD_EVENT_KIND_LABELS[event.kind]}, {describeLoadEvent(event)}
            </span>
          </h3>
          <span className="text-xs text-muted">
            {formatDate(event.season_start)} to {formatDate(event.season_end)}
          </span>
        </div>
        <LoadEventFields idPrefix={`load-event-${event.id}`} draft={draft} onChange={setDraft} />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!dirty || save.isPending}
            onClick={submit}
            aria-label={`Save ${event.name}`}
          >
            Save
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setDraft(draftFromLoadEvent(event))}>
              Undo changes
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onDelete} aria-label={`Delete ${event.name}`}>
            Delete
          </Button>
        </div>
      </Card>
    </li>
  );
}

function NewLoadEventCard() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<LoadEventDraft>(() => emptyDraft());
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch<LoadEvent>("/load-events", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (created) => {
      setDraft(emptyDraft());
      setError(null);
      toast.success(`Added "${created.name}"`);
      invalidate(queryClient);
    },
    onError: (err: unknown) => setError(`Failed to add: ${errorMessage(err)}`),
  });

  function submit() {
    const result = draftToPayload(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    create.mutate(result.payload);
  }

  return (
    <Card className="mt-4 flex flex-col gap-4 p-4">
      <h3 className="font-medium">Add a game or practice</h3>
      <LoadEventFields idPrefix="new-load-event" draft={draft} onChange={setDraft} />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div>
        <Button variant="primary" disabled={create.isPending} onClick={submit}>
          Add to schedule
        </Button>
      </div>
    </Card>
  );
}

export function SportScheduleView() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<LoadEvent | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: LOAD_EVENTS_KEY,
    queryFn: () => apiFetch<Paginated<LoadEvent>>("/load-events?limit=100"),
  });

  const remove = useMutation({
    mutationFn: (event: LoadEvent) => apiFetch(`/load-events/${event.id}`, { method: "DELETE" }),
    onSuccess: (_, event) => {
      toast.success(`Deleted "${event.name}"`);
      invalidate(queryClient);
    },
    onError: (err: unknown) => toast.error(`Failed to delete: ${errorMessage(err)}`),
  });

  const events = data?.items ?? [];

  return (
    <section id="sport-schedule-view">
      <PageHeading hint="Weekly games and practices, such as ice hockey. They show on the calendar so workouts can be planned around them.">
        Sport schedule
      </PageHeading>

      {isLoading ? <p className="text-sm text-muted">Loading schedule…</p> : null}
      {error ? (
        <p className="text-sm text-danger">Failed to load schedule: {errorMessage(error)}</p>
      ) : null}

      {!isLoading && !error && events.length === 0 ? (
        <EmptyState
          title="No games or practices yet"
          description="Add each weekly game or practice once for the season."
        />
      ) : null}

      <ul className="flex flex-col gap-4" aria-label="Sport schedule">
        {events.map((event) => (
          <LoadEventCard
            key={`${event.id}:${event.updated_at}`}
            event={event}
            onDelete={() => setDeleteTarget(event)}
          />
        ))}
      </ul>

      {!isLoading && !error ? <NewLoadEventCard /> : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
        }}
        title="Delete from schedule"
        message={`Delete "${deleteTarget?.name}" for the whole season?`}
        confirmLabel="Delete"
      />
    </section>
  );
}
