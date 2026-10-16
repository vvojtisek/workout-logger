import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type {
  LoadEventOccurrence,
  LoadWarning,
  Paginated,
  Program,
  ScheduledWorkout,
  WorkoutPlan,
  WorkoutSession,
} from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { CALENDAR_WEEKDAYS, leadingBlankDays } from "@/lib/calendar";
import {
  LOAD_EVENT_KIND_LABELS,
  clockTime,
  loadWarningMessage,
  occurrencesByDate,
} from "@/lib/load-events";
import { Button, Card, PageHeading } from "@/ui";
import { Dialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { formatDate } from "@/lib/format";

const STATUS_STYLES: Record<ScheduledWorkout["status"], string> = {
  scheduled: "bg-elevated text-main",
  in_progress: "bg-accent text-on-accent",
  completed: "bg-success-soft text-success",
  skipped: "bg-danger-soft text-danger",
};

const STATUS_LABELS: Record<ScheduledWorkout["status"], string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthLabel(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleString("default", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function ScheduleDialog({
  open,
  date,
  plans,
  programs,
  onClose,
  onScheduled,
}: {
  open: boolean;
  date: string | null;
  plans: WorkoutPlan[];
  programs: Program[];
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [planId, setPlanId] = useState("");
  const [programId, setProgramId] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<ScheduledWorkout>("/scheduled-workouts", {
        method: "POST",
        body: JSON.stringify({
          workout_plan_id: planId,
          program_id: programId || null,
          scheduled_date: date,
        }),
      }),
    onSuccess: () => {
      toast.success("Workout scheduled");
      onScheduled();
      onClose();
      setPlanId("");
      setProgramId("");
    },
    onError: (err: unknown) => toast.error(`Failed to schedule: ${errorMessage(err)}`),
  });

  return (
    <Dialog open={open} onClose={onClose} title={`Schedule a workout${date ? ` — ${formatDate(date)}` : ""}`}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="field-label" htmlFor="schedule-plan">
            Workout plan
          </label>
          <select
            id="schedule-plan"
            className="input"
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
          >
            <option value="">Select a plan…</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="schedule-program">
            Program (optional)
          </label>
          <select
            id="schedule-program"
            className="input"
            value={programId}
            onChange={(event) => setProgramId(event.target.value)}
          >
            <option value="">No program</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!planId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Schedule
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function EntryDialog({
  entry,
  onClose,
  warning,
  onChanged,
}: {
  entry: ScheduledWorkout | null;
  warning: LoadWarning | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { openSession } = useAppContext();
  const [newDate, setNewDate] = useState(entry?.scheduled_date ?? "");
  const [swapPlanId, setSwapPlanId] = useState("");

  useEffect(() => {
    if (entry) setNewDate(entry.scheduled_date);
    setSwapPlanId(warning?.swap_plans[0]?.id ?? "");
  }, [entry?.id, entry?.scheduled_date, warning?.swap_plans]);

  const start = useMutation({
    mutationFn: (id: string) =>
      apiFetch<WorkoutSession>(`/scheduled-workouts/${id}/start`, { method: "POST" }),
    onSuccess: (session) => {
      onClose();
      openSession(session);
    },
    onError: (err: unknown) => toast.error(`Failed to start: ${errorMessage(err)}`),
  });

  const reschedule = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      apiFetch<ScheduledWorkout>(`/scheduled-workouts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      toast.success("Updated");
      onChanged();
      onClose();
    },
    onError: (err: unknown) => toast.error(`Failed to update: ${errorMessage(err)}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/scheduled-workouts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Unscheduled");
      onChanged();
      onClose();
    },
    onError: (err: unknown) => toast.error(`Failed to delete: ${errorMessage(err)}`),
  });

  if (!entry) return null;
  const canSkip = entry.status === "scheduled" || entry.status === "skipped";

  return (
    <Dialog open={entry !== null} onClose={onClose} title={entry.workout_plan_name}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          {formatDate(entry.scheduled_date)} · {entry.program_name ? `${entry.program_name} · ` : ""}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[entry.status]}`}>
            {STATUS_LABELS[entry.status]}
          </span>
        </p>
        {entry.notes ? (
          <p className="scheduled-notes whitespace-pre-line text-sm">{entry.notes}</p>
        ) : null}

        {warning && entry.status === "scheduled" ? (
          <div
            role="alert"
            data-testid="load-warning"
            className="flex flex-col gap-2 rounded-md bg-danger-soft p-3 text-sm text-danger"
          >
            <p>{loadWarningMessage(warning, entry.scheduled_date)}</p>
            <div className="flex flex-wrap items-center gap-2">
              {warning.move_to ? (
                <Button
                  disabled={reschedule.isPending}
                  onClick={() =>
                    reschedule.mutate({ id: entry.id, patch: { scheduled_date: warning.move_to } })
                  }
                >
                  Move to {formatDate(warning.move_to)}
                </Button>
              ) : null}
              {warning.swap_plans.length > 0 ? (
                <>
                  <label className="sr-only" htmlFor="swap-plan">
                    Plan to swap in
                  </label>
                  <select
                    id="swap-plan"
                    className="input w-auto"
                    value={swapPlanId}
                    onChange={(event) => setSwapPlanId(event.target.value)}
                  >
                    {warning.swap_plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={!swapPlanId || reschedule.isPending}
                    onClick={() =>
                      reschedule.mutate({ id: entry.id, patch: { workout_plan_id: swapPlanId } })
                    }
                  >
                    Swap plan
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {entry.status === "scheduled" ? (
          <div>
            <label className="field-label" htmlFor="reschedule-date">
              Move to a different date
            </label>
            <div className="flex gap-2">
              <input
                id="reschedule-date"
                type="date"
                className="input"
                value={newDate}
                onChange={(event) => setNewDate(event.target.value)}
              />
              <Button
                disabled={newDate === entry.scheduled_date || reschedule.isPending}
                onClick={() =>
                  reschedule.mutate({ id: entry.id, patch: { scheduled_date: newDate } })
                }
              >
                Move
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {entry.status === "scheduled" ? (
            <Button variant="primary" onClick={() => start.mutate(entry.id)} disabled={start.isPending}>
              Start
            </Button>
          ) : null}
          {canSkip ? (
            <Button
              onClick={() =>
                reschedule.mutate({
                  id: entry.id,
                  patch: { status: entry.status === "skipped" ? "scheduled" : "skipped" },
                })
              }
              disabled={reschedule.isPending}
            >
              {entry.status === "skipped" ? "Unskip" : "Skip"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => remove.mutate(entry.id)} disabled={remove.isPending}>
            Delete
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function CalendarView() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() });
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<ScheduledWorkout | null>(null);

  const monthLength = daysInMonth(cursor.year, cursor.month);
  const fromDate = isoDate(cursor.year, cursor.month, 1);
  const toDate = isoDate(cursor.year, cursor.month, monthLength);

  const calendarQuery = useQuery({
    queryKey: ["calendar", cursor.year, cursor.month],
    queryFn: () =>
      apiFetch<{
        items: ScheduledWorkout[];
        load_events?: LoadEventOccurrence[];
        load_warnings?: LoadWarning[];
      }>(
        `/calendar?from=${fromDate}&to=${toDate}`,
      ),
  });

  const plansQuery = useQuery({
    queryKey: ["plans"],
    queryFn: () => apiFetch<Paginated<WorkoutPlan>>("/plans?limit=100"),
  });
  const programsQuery = useQuery({
    queryKey: ["programs"],
    queryFn: () => apiFetch<Paginated<Program>>("/programs?limit=100"),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
  }

  const entriesByDate = new Map<string, ScheduledWorkout[]>();
  for (const item of calendarQuery.data?.items ?? []) {
    const list = entriesByDate.get(item.scheduled_date) ?? [];
    list.push(item);
    entriesByDate.set(item.scheduled_date, list);
  }

  const loadByDate = occurrencesByDate(calendarQuery.data?.load_events ?? []);
  const warningById = new Map(
    (calendarQuery.data?.load_warnings ?? []).map((warning) => [warning.scheduled_workout_id, warning]),
  );

  const leadingBlanks = leadingBlankDays(cursor.year, cursor.month);
  const dayCells = Array.from({ length: monthLength }, (_, index) => index + 1);

  return (
    <section id="calendar-view">
      <div className="mb-5 flex items-start justify-between gap-3 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <PageHeading hint="Tap a day to schedule a workout. Tap a scheduled workout to start, move, skip, or remove it. Dashed entries are games and practices from your sport schedule; a workout marked ! has heavy leg work too close before one.">
          Calendar
        </PageHeading>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <Button
          aria-label="Previous month"
          onClick={() =>
            setCursor((current) =>
              current.month === 0
                ? { year: current.year - 1, month: 11 }
                : { year: current.year, month: current.month - 1 },
            )
          }
        >
          ← Prev
        </Button>
        <h3 className="font-medium">{monthLabel(cursor.year, cursor.month)}</h3>
        <Button
          aria-label="Next month"
          onClick={() =>
            setCursor((current) =>
              current.month === 11
                ? { year: current.year + 1, month: 0 }
                : { year: current.year, month: current.month + 1 },
            )
          }
        >
          Next →
        </Button>
      </div>

      {calendarQuery.error ? (
        <p className="text-sm text-danger">
          Failed to load calendar: {errorMessage(calendarQuery.error)}
        </p>
      ) : null}

      <div
        id="calendar-weekdays"
        className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-muted"
      >
        {CALENDAR_WEEKDAYS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {Array.from({ length: leadingBlanks }, (_, index) => (
          <div key={`blank-${index}`} />
        ))}
        {dayCells.map((day) => {
          const dateStr = isoDate(cursor.year, cursor.month, day);
          const entries = entriesByDate.get(dateStr) ?? [];
          const loads = loadByDate.get(dateStr) ?? [];
          return (
            <Card key={dateStr} className="flex min-h-[5.5rem] flex-col gap-1 p-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">{day}</span>
                <button
                  type="button"
                  aria-label={`Schedule a workout on ${dateStr}`}
                  className="rounded-full px-1.5 text-sm font-medium text-muted hover:text-accent"
                  style={{ minHeight: "var(--touch)", minWidth: "var(--touch)" }}
                  onClick={() => setScheduleDate(dateStr)}
                >
                  +
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {loads.map((load) => (
                  <div
                    key={`${load.event_id}:${load.start_time}`}
                    data-testid="calendar-load-event"
                    title={`${load.name}, ${clockTime(load.start_time)}, ${load.duration_minutes} min`}
                    className="overflow-hidden whitespace-nowrap rounded-md border border-dashed border-accent py-0.5 text-center text-[0.6rem] tracking-tighter text-accent sm:truncate sm:px-1.5 sm:text-left sm:text-xs sm:tracking-normal"
                  >
                    {/* Phone cells only fit the time; the kind joins it on wider screens. */}
                    <span className="hidden sm:inline">{LOAD_EVENT_KIND_LABELS[load.kind]} </span>
                    {clockTime(load.start_time)}
                  </div>
                ))}
                {entries.map((entry) => {
                  const flagged = entry.status === "scheduled" && warningById.has(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setActiveEntry(entry)}
                      aria-label={
                        flagged
                          ? `${entry.workout_plan_name}, heavy legs before hockey`
                          : undefined
                      }
                      className={`truncate rounded-md px-1.5 py-0.5 text-left text-xs font-medium ${STATUS_STYLES[entry.status]} ${flagged ? "ring-2 ring-danger" : ""}`}
                    >
                      {flagged ? (
                        <span data-testid="calendar-load-warning" className="mr-0.5 font-bold text-danger">
                          !
                        </span>
                      ) : null}
                      {entry.workout_plan_name}
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      <ScheduleDialog
        open={scheduleDate !== null}
        date={scheduleDate}
        plans={plansQuery.data?.items ?? []}
        programs={programsQuery.data?.items ?? []}
        onClose={() => setScheduleDate(null)}
        onScheduled={refresh}
      />
      <EntryDialog
        entry={activeEntry}
        warning={activeEntry ? (warningById.get(activeEntry.id) ?? null) : null}
        onClose={() => setActiveEntry(null)}
        onChanged={refresh}
      />
    </section>
  );
}
