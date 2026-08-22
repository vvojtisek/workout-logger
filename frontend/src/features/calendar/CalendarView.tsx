import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { Paginated, Program, ScheduledWorkout, WorkoutPlan, WorkoutSession } from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { Button, Card, PageHeading } from "@/ui";
import { Dialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_STYLES: Record<ScheduledWorkout["status"], string> = {
  scheduled: "bg-surface-raised text-text",
  in_progress: "bg-accent text-white",
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

function firstWeekday(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
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
    <Dialog open={open} onClose={onClose} title={`Schedule a workout${date ? ` — ${date}` : ""}`}>
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
  onChanged,
}: {
  entry: ScheduledWorkout | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { openSession } = useAppContext();
  const [newDate, setNewDate] = useState(entry?.scheduled_date ?? "");

  useEffect(() => {
    if (entry) setNewDate(entry.scheduled_date);
  }, [entry?.id, entry?.scheduled_date]);

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
          {entry.program_name ? `${entry.program_name} · ` : ""}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[entry.status]}`}>
            {STATUS_LABELS[entry.status]}
          </span>
        </p>

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
      apiFetch<{ items: ScheduledWorkout[] }>(`/calendar?from=${fromDate}&to=${toDate}`),
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

  const leadingBlanks = firstWeekday(cursor.year, cursor.month);
  const dayCells = Array.from({ length: monthLength }, (_, index) => index + 1);

  return (
    <section id="calendar-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Tap a day to schedule a workout. Tap a scheduled workout to start, move, skip, or remove it.">
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

      <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-muted">
        {WEEKDAY_LABELS.map((label) => (
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
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setActiveEntry(entry)}
                    className={`truncate rounded-md px-1.5 py-0.5 text-left text-xs font-medium ${STATUS_STYLES[entry.status]}`}
                  >
                    {entry.workout_plan_name}
                  </button>
                ))}
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
        onClose={() => setActiveEntry(null)}
        onChanged={refresh}
      />
    </section>
  );
}
