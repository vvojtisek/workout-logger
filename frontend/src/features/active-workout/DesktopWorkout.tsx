import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { ExerciseStats, SessionExercise, WorkoutSession } from "@/api/types";
import { activeWorkoutStorage } from "@/lib/active-workout-storage";
import { draftStorageKey, saveSetDraft } from "@/lib/active-workout-state";
import type { SynchronizationState } from "@/lib/active-workout-state";
import { fetchCatalogueNames } from "@/lib/exercise-catalogue";
import { formatDate } from "@/lib/format";
import { FEELING_SCALE, RIR_HINT } from "@/lib/scales";
import {
  copyDraftFrom,
  exerciseSummaries,
  lastCompletedEntry,
  progressionChart,
  targetText,
} from "@/lib/workout-desktop";
import type { ExerciseSummary } from "@/lib/workout-desktop";
import type { HudRow } from "@/lib/workout-hud";
import type { ExerciseKind, GridRow } from "@/lib/workout-utils";
import { Dialog } from "@/ui/Dialog";
import { ScaleSelect } from "@/ui/ScaleSelect";
import { toast } from "@/ui/Toast";
import { RestOverlay } from "./RestOverlay";
import { COLUMN_HEADERS_BY_KIND, ROW_GRID, SetRow } from "./SetRow";
import type { SetValues } from "./SetRow";
import { ElapsedClock } from "./WorkoutHud";

const PILL_CLASS: Record<ExerciseSummary["status"], string> = {
  done: "bg-success-soft text-success",
  partial: "bg-accent-soft text-accent",
  todo: "bg-warn-soft text-warn",
};

export interface DesktopWorkoutProps {
  session: WorkoutSession;
  rows: HudRow[];
  index: number;
  progress: { done: number; total: number; percent: number };
  sync: SynchronizationState;
  restWasSkipped: boolean;
  stats: Map<string, ExerciseStats>;
  statsLine: (exercise: SessionExercise) => ReactNode;
  gridRef: RefObject<HTMLDivElement | null>;
  feeling: string;
  onFeelingChange: (value: string) => void;
  onComplete: (row: GridRow, values: SetValues) => void;
  onSkip: (row: GridRow, values: SetValues) => void;
  onCorrect: (row: GridRow, values: SetValues) => Promise<boolean>;
  onUndo: (row: GridRow) => void;
  onFocus: (row: GridRow) => void;
  onAdjustRest: (seconds: number) => void;
  onSkipRest: () => void;
  onRetrySync: () => void;
  onFinish: () => void;
  onSessionChange: (session: WorkoutSession) => void;
}

/** The desktop live workout: the session's exercises on the left, the shown
 * exercise's sets, rest timer and progression on the right. The shown
 * exercise is the server's focus, so selecting one survives a reload and the
 * view moves on by itself as sets are logged. */
export function DesktopWorkout(props: DesktopWorkoutProps) {
  const { session, rows, index, progress } = props;
  const summaries = exerciseSummaries(rows);
  const shown = rows[index] ?? null;
  const exercise = (shown?.exercise ?? null) as SessionExercise | null;

  return (
    <section id="active-workout-view" className="grid h-full min-h-0 grid-cols-[340px_1fr]">
      <nav
        aria-label="Workout exercises"
        className="flex min-h-0 flex-col overflow-y-auto border-r border-line bg-subtle"
      >
        <div className="flex flex-col gap-2 border-b border-line-muted p-4">
          <p id="active-plan-name" className="truncate text-sm text-muted">
            {session.source_plan_name}
          </p>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Active Workout</h2>
            <ElapsedClock startedAt={session.started_at} />
          </div>
          <progress id="active-progress" className="w-full" max={100} value={progress.percent} />
          <p id="active-progress-text" className="text-sm font-medium" data-numeric>
            {progress.done} of {progress.total} sets
          </p>
        </div>
        <ol className="flex flex-col gap-1 p-2">
          {summaries.map((summary) => (
            <li key={summary.exercise.id}>
              <ExerciseListItem
                summary={summary}
                current={summary.exercise.id === exercise?.id}
                onSelect={() => {
                  if (summary.openRow && summary.exercise.id !== exercise?.id) {
                    props.onFocus(summary.openRow);
                  }
                }}
              />
            </li>
          ))}
        </ol>
      </nav>
      <div className="@container min-h-0 overflow-y-auto px-6 pt-5 pb-16">
        {exercise && shown ? (
          <ExercisePane {...props} exercise={exercise} badge={shown.badge} />
        ) : null}
      </div>
    </section>
  );
}

function ExerciseListItem({
  summary,
  current,
  onSelect,
}: {
  summary: ExerciseSummary;
  current: boolean;
  onSelect: () => void;
}) {
  const exercise = summary.exercise as SessionExercise;
  return (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-left ${
        current ? "border-accent bg-elevated" : "border-transparent hover:bg-elevated"
      }`}
      style={{ minHeight: "var(--touch)" }}
    >
      {summary.badge ? (
        <span className="rounded bg-purple-soft px-1.5 py-0.5 text-xs font-bold text-purple" data-numeric>
          {summary.badge}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{exercise.exercise_name}</span>
        <span className="block text-xs text-muted" data-numeric>
          {targetText(exercise)}
        </span>
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PILL_CLASS[summary.status]}`}
        data-numeric
      >
        <span aria-hidden="true">
          {summary.logged}/{summary.total}
        </span>
        <span className="sr-only">
          {summary.logged} of {summary.total} sets logged
        </span>
      </span>
    </button>
  );
}

function ExercisePane({
  exercise,
  badge,
  ...props
}: DesktopWorkoutProps & { exercise: SessionExercise; badge: string | null }) {
  const { session } = props;
  const [copyNonce, setCopyNonce] = useState(0);
  const [swapOpen, setSwapOpen] = useState(false);
  const ownRows = props.rows
    .filter((row) => row.exercise.id === exercise.id)
    .sort((a, b) => a.setNumber - b.setNumber);
  const pending = ownRows.find((row) => row.entry === null) ?? null;
  const lastEntry = lastCompletedEntry(exercise);
  const hasEntries = exercise.set_entries.length > 0;

  async function addSet() {
    try {
      props.onSessionChange(
        await apiFetch<WorkoutSession>(
          `/workout-sessions/${session.id}/exercises/${exercise.id}/sets`,
          { method: "POST" }
        )
      );
    } catch (err) {
      toast.error(`Failed to add a set: ${errorMessage(err)}`);
    }
  }

  async function copyLastSet() {
    if (!lastEntry || !pending) return;
    await saveSetDraft(
      activeWorkoutStorage,
      draftStorageKey(session.id, exercise.id, pending.setNumber),
      copyDraftFrom(lastEntry)
    );
    // Remounting the rows makes the pending one re-read its draft.
    setCopyNonce((value) => value + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {badge ? (
              <span
                className="rounded bg-purple-soft px-2 py-0.5 text-sm font-bold text-purple"
                data-testid="superset-badge"
                data-numeric
              >
                {badge}
              </span>
            ) : null}
            <h2 className="text-2xl font-semibold tracking-tight break-words">{exercise.exercise_name}</h2>
          </div>
          {props.statsLine(exercise)}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-touch"
          disabled={hasEntries}
          title={hasEntries ? "An exercise with logged sets can't be swapped" : undefined}
          onClick={() => setSwapOpen(true)}
        >
          Swap Exercise
        </button>
        <button
          type="button"
          id="finish-active-workout"
          onClick={props.onFinish}
          className="btn btn-touch bg-success font-semibold text-on-success"
        >
          Finish workout
        </button>
      </header>

      {exercise.exercise_kind === "strength" ? (
        <p id="rir-hint" className="-mt-2 text-xs text-muted">
          {RIR_HINT}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 @min-[73rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div id="active-grid" ref={props.gridRef} className="card overflow-x-auto px-3 pb-2">
            <div className={`${ROW_GRID} py-2 text-xs font-semibold text-muted`}>
              {COLUMN_HEADERS_BY_KIND[exercise.exercise_kind].map((label) => (
                <span key={label} role="columnheader">
                  {label}
                </span>
              ))}
            </div>
            {ownRows.map((row) => (
              <SetRow
                key={`${exercise.id}:${row.setNumber}:${copyNonce}`}
                row={row}
                sessionId={session.id}
                totalSets={props.progress.total}
                onComplete={props.onComplete}
                onSkip={props.onSkip}
                onCorrect={props.onCorrect}
                onUndo={props.onUndo}
                onFocusSet={props.onFocus}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-touch" onClick={() => void addSet()}>
              + Add Set
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-touch"
              disabled={!lastEntry || !pending}
              onClick={() => void copyLastSet()}
            >
              Copy Last Set
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <RestOverlay
            restEndsAt={session.rest_ends_at}
            restWasSkipped={props.restWasSkipped}
            sync={props.sync}
            onAdjust={props.onAdjustRest}
            onSkip={props.onSkipRest}
            onRetrySync={props.onRetrySync}
          />
          <div className="card p-4">
            <label className="field-label" htmlFor="active-feeling">
              Overall feeling
            </label>
            <ScaleSelect
              id="active-feeling"
              className="input min-h-touch"
              scale={FEELING_SCALE}
              value={props.feeling}
              onChange={props.onFeelingChange}
            />
          </div>
          <ProgressionCard stats={props.stats.get(exercise.exercise_name)} />
        </div>
      </div>

      <SwapDialog
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        session={session}
        exercise={exercise}
        onSwapped={(updated) => {
          setSwapOpen(false);
          props.onSessionChange(updated);
        }}
      />
    </div>
  );
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 120;

function formatKg(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} kg`;
}

function ProgressionCard({ stats }: { stats: ExerciseStats | undefined }) {
  const recent = stats?.recent ?? [];
  const chart = progressionChart(recent, CHART_WIDTH, CHART_HEIGHT);
  const best = [...recent]
    .filter((point) => point.estimated_one_rep_max_kg !== null)
    .sort((a, b) => (b.estimated_one_rep_max_kg ?? 0) - (a.estimated_one_rep_max_kg ?? 0))
    .slice(0, 3);

  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="progression-card">
      <h3 className="font-semibold">Progression</h3>
      {chart ? (
        <>
          <svg
            role="img"
            aria-label={`Estimated 1RM over the last ${chart.points.length} sessions, ${formatKg(chart.points[0].session.estimated_one_rep_max_kg ?? 0)} to ${formatKg(chart.points[chart.points.length - 1].session.estimated_one_rep_max_kg ?? 0)}`}
            data-testid="progression-chart"
            viewBox={`-6 -6 ${CHART_WIDTH + 12} ${CHART_HEIGHT + 12}`}
            className="h-32 w-full"
          >
            <polyline
              points={chart.points.map((point) => `${point.x},${point.y}`).join(" ")}
              className="fill-none stroke-accent"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {chart.points.map((point) => (
              <circle
                key={point.session.performed_at}
                cx={point.x}
                cy={point.y}
                r={4}
                className="fill-accent"
              />
            ))}
          </svg>
          <p className="text-xs text-muted" data-numeric>
            e1RM {formatKg(chart.min)} – {formatKg(chart.max)}
          </p>
          <div>
            <h4 className="mb-1 text-sm font-medium">Best sets</h4>
            <ul className="flex flex-col gap-1 text-sm" data-numeric>
              {best.map((point) => (
                <li key={point.performed_at} className="flex justify-between gap-2">
                  <span className="text-muted">{formatDate(point.performed_at)}</span>
                  <span>
                    {formatKg(point.weight_kg ?? 0)} × {point.top_reps}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">No weighted history for this exercise yet.</p>
      )}
    </section>
  );
}

function SwapDialog({
  open,
  onClose,
  session,
  exercise,
  onSwapped,
}: {
  open: boolean;
  onClose: () => void;
  session: WorkoutSession;
  exercise: SessionExercise;
  onSwapped: (session: WorkoutSession) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ExerciseKind>(exercise.exercise_kind);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: names = [] } = useQuery({
    queryKey: ["exercise-catalogue-names"],
    queryFn: () => fetchCatalogueNames((path) => apiFetch(path)),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = nameRef.current?.value.trim() ?? "";
    if (!name) {
      setError("Enter the exercise to do instead.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSwapped(
        await apiFetch<WorkoutSession>(`/workout-sessions/${session.id}/exercises/${exercise.id}`, {
          method: "PATCH",
          body: JSON.stringify({ exercise_name: name, exercise_kind: kind }),
        })
      );
      if (nameRef.current) nameRef.current.value = "";
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Swap ${exercise.exercise_name}`}>
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-muted">
          Only this workout changes; the plan keeps its exercise.
        </p>
        <label className="field-label" htmlFor="swap-exercise-name">
          Exercise instead
        </label>
        <input
          ref={nameRef}
          id="swap-exercise-name"
          className="input min-h-touch"
          list="swap-exercise-names"
          maxLength={150}
          autoComplete="off"
        />
        <datalist id="swap-exercise-names">
          {names.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <label className="field-label" htmlFor="swap-exercise-kind">
          Exercise type
        </label>
        <select
          id="swap-exercise-kind"
          className="input min-h-touch"
          value={kind}
          onChange={(event) => setKind(event.target.value as ExerciseKind)}
        >
          <option value="strength">Strength</option>
          <option value="bodyweight">Bodyweight</option>
          <option value="cardio">Cardio</option>
        </select>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-touch" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-touch" disabled={saving}>
            Swap
          </button>
        </div>
      </form>
    </Dialog>
  );
}
