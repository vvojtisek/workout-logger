import { useEffect, useRef, useState } from "react";
import type { ReactNode, TouchEvent } from "react";
import { X } from "lucide-react";

import type { ExerciseStats, WorkoutSession } from "@/api/types";
import { activeWorkoutStorage } from "@/lib/active-workout-storage";
import {
  clearSetDraft,
  draftStorageKey,
  loadSetDraft,
  saveSetDraft,
} from "@/lib/active-workout-state";
import type {
  SetDraft,
  SynchronizationState,
} from "@/lib/active-workout-state";
import { FEELING_SCALE, RIR_HINT } from "@/lib/scales";
import { suggestionLabel } from "@/lib/workout-utils";
import {
  RIR_PILLS,
  exercisePosition,
  formatCountdown,
  formatElapsed,
  nextExercise,
  previousExercise,
  previousSet,
  rirPillValue,
  stepValue,
} from "@/lib/workout-hud";
import type { HudRow } from "@/lib/workout-hud";
import { ScaleSelect } from "@/ui/ScaleSelect";
import { useRestCountdown } from "./RestOverlay";
import { EMPTY_DRAFT, FIELD_SPECS_BY_KIND, draftToValues, fieldHint } from "./SetRow";
import type { FieldSpec, SetValues } from "./SetRow";

const UNDO_WINDOW_MS = 5_000;
const SWIPE_MIN_PX = 60;

/** Stepper increments for each numeric field; RIR uses pills, band is text. */
const STEPS: Partial<
  Record<keyof SetDraft, { delta: number; min: number; unit: string }>
> = {
  weight: { delta: 2.5, min: 0, unit: "kg" },
  added_weight_kg: { delta: 2.5, min: 0, unit: "kg" },
  reps: { delta: 1, min: 1, unit: "rep" },
  duration_seconds: { delta: 15, min: 0, unit: "s" },
  distance_km: { delta: 0.1, min: 0, unit: "km" },
  incline_percent: { delta: 0.5, min: -100, unit: "%" },
};

/** Short dial captions; the input keeps the field's full label as its name. */
const CAPTIONS: Partial<Record<keyof SetDraft, string>> = {
  weight: "Weight (kg)",
  added_weight_kg: "Added (kg)",
  reps: "Reps",
  duration_seconds: "Time (s)",
  distance_km: "Distance (km)",
  incline_percent: "Incline (%)",
};

function formatKg(value: number): string {
  return `${value.toFixed(1)} kg`;
}

/** "Last session: 70.0 kg × 8", from the most recent logged session. Logs do
 * not keep RIR, so it is left out. */
function lastSessionText(
  stats: ExerciseStats | undefined,
  setNumber: number,
): string | null {
  if (!stats?.last_reps_per_set?.length) return null;
  const reps =
    stats.last_reps_per_set[setNumber - 1] ??
    stats.last_reps_per_set[stats.last_reps_per_set.length - 1];
  const load = stats.last_weight_kg
    ? `${formatKg(stats.last_weight_kg)} × ${reps}`
    : `${reps} reps`;
  return `Last session: ${load}`;
}

/** What a set's dials start at: its saved values, else the values logged for
 * the previous set of the same exercise (most sets repeat the last one), else
 * the plan's or history's suggestion. */
function seedDraft(row: HudRow, previous: HudRow | null): SetDraft {
  const entry = row.entry ?? previous?.entry ?? null;
  if (entry) {
    return {
      weight: (entry.weight_kg ?? "").toString(),
      reps: entry.reps.toString(),
      // RIR is judged fresh on every set, so it is only kept for a saved one.
      rir: row.entry ? (entry.rir ?? "").toString() : "",
      added_weight_kg: (entry.added_weight_kg ?? "").toString(),
      band_level: entry.band_level ?? "",
      duration_seconds: (entry.duration_seconds ?? "").toString(),
      distance_km: (entry.distance_km ?? "").toString(),
      incline_percent: (entry.incline_percent ?? "").toString(),
    };
  }
  return {
    ...EMPTY_DRAFT,
    weight: (row.exercise.suggested_weight_kg ?? "").toString(),
    reps: row.exercise.suggested_reps.toString(),
  };
}

export function ElapsedClock({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(handle);
  }, []);
  return (
    <span id="active-elapsed" className="text-sm text-muted" data-numeric>
      {formatElapsed(startedAt, now)}
    </span>
  );
}

export interface WorkoutHudProps {
  session: WorkoutSession;
  rows: HudRow[];
  index: number;
  progress: { done: number; total: number; percent: number };
  sync: SynchronizationState;
  restWasSkipped: boolean;
  stats: Map<string, ExerciseStats>;
  statsLine: ReactNode;
  feeling: string;
  onFeelingChange: (value: string) => void;
  onComplete: (row: HudRow, values: SetValues) => void;
  onSkip: (row: HudRow, values: SetValues) => void;
  /** Resolves true once the correction is saved, which ends editing. */
  onCorrect: (row: HudRow, values: SetValues) => Promise<boolean>;
  onUndo: (row: HudRow) => void;
  onFocus: (row: HudRow) => void;
  onAdjustRest: (seconds: number) => void;
  onSkipRest: () => void;
  onRetrySync: () => void;
  onFinish: () => void;
  onMinimize: () => void;
}

/**
 * The phone's one-handed workout screen: one set at a time, big steppers in
 * the bottom of the screen, and a single action that turns into the rest
 * timer in place. It fills the viewport and never scrolls in normal use.
 */
export function WorkoutHud(props: WorkoutHudProps) {
  const { session, rows, index, progress, sync } = props;
  const row = rows[index];
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // A sideways swipe changes exercise. Chrome would otherwise take it as the
  // page's back/forward gesture, which is set on the document's root scroller.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = "none";
    return () => {
      root.style.overscrollBehaviorX = previous;
    };
  }, []);

  if (!row) return null;

  const position = exercisePosition(rows, index);
  // The latest logged set of this exercise before this one; its values seed
  // the dials, since most sets repeat the last.
  const previousLogged =
    rows
      .filter(
        (candidate) =>
          candidate.exercise.id === row.exercise.id &&
          candidate.setNumber < row.setNumber &&
          candidate.entry?.state === "completed",
      )
      .at(-1) ?? null;
  const allLogged = rows.every((candidate) => candidate.entry !== null);
  const prev = previousSet(rows, index);
  const next = nextExercise(rows, index);

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx)) return;
    const target =
      dx < 0 ? nextExercise(rows, index) : previousExercise(rows, index);
    if (target) props.onFocus(target);
  }

  return (
    <section
      id="active-workout-view"
      data-layout="hud"
      className="flex h-dvh flex-col overflow-hidden overscroll-none bg-[image:var(--hud-gradient)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <header className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Minimize workout"
            onClick={props.onMinimize}
            className="btn btn-ghost h-11 w-11 p-0"
          >
            <X aria-hidden="true" size={20} />
          </button>
          <p
            id="active-plan-name"
            className="min-w-0 flex-1 truncate text-sm font-semibold"
          >
            {session.source_plan_name}
          </p>
          <ElapsedClock startedAt={session.started_at} />
          {allLogged ? null : (
            <button
              type="button"
              id="finish-active-workout"
              onClick={props.onFinish}
              className="btn btn-ghost h-11 px-2 text-xs"
            >
              Finish
            </button>
          )}
        </div>
        <progress
          id="active-progress"
          className="h-1.5 [block-size:6px]"
          max={100}
          value={progress.percent}
          aria-label="Sets completed"
        />
        <div className="flex items-center justify-between text-xs text-muted">
          <span id="active-progress-text" data-numeric>
            {progress.done} of {progress.total} sets
          </span>
          <span
            id="active-sync-status"
            aria-live="polite"
            data-state={sync.status}
            className={
              sync.status === "failed"
                ? "text-danger"
                : sync.status === "pending"
                  ? "text-warn"
                  : ""
            }
          >
            {sync.label}
          </span>
          <button
            type="button"
            id="retry-active-sync"
            hidden={sync.status !== "failed"}
            onClick={props.onRetrySync}
            className="btn btn-secondary px-2 py-1 text-xs"
          >
            Retry synchronization
          </button>
        </div>
      </header>

      <div
        className="flex min-h-0 flex-1 touch-pan-y flex-col overflow-y-auto overscroll-x-none"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex flex-col items-center gap-1 pt-4 pb-3 text-center">
          <p
            id="hud-position"
            className="text-[11px] font-semibold tracking-widest text-muted"
            data-numeric
          >
            EXERCISE {position.index} OF {position.total} • SET {row.setNumber}{" "}
            OF {row.exercise.target_sets}
          </p>
          <div className="flex items-center gap-2">
            {row.badge ? (
              <span
                className="rounded-[var(--radius-sm)] bg-purple-soft px-1.5 py-0.5 text-xs font-semibold text-purple"
                data-numeric
              >
                {row.badge}
              </span>
            ) : null}
            <h2 className="text-xl font-semibold tracking-tight">
              {row.exercise.exercise_name}
            </h2>
          </div>
          {(() => {
            const last = lastSessionText(
              props.stats.get(row.exercise.exercise_name),
              row.setNumber,
            );
            return last ? (
              <p
                id="hud-last-session"
                className="text-sm text-muted"
                data-numeric
              >
                {last}
              </p>
            ) : null;
          })()}
          {props.statsLine}
          {row.entry ? null : (
            <p className="text-xs text-warn">
              {previousLogged
                ? `Repeating set ${previousLogged.setNumber} · not saved`
                : suggestionLabel(row.exercise.suggestion_source, row.exercise.suggestion_note)}
            </p>
          )}
        </div>

        <SetPanel
          key={`${row.exercise.id}:${row.setNumber}:${row.entry?.id ?? "draft"}`}
          {...props}
          row={row}
          previous={previousLogged}
          allLogged={allLogged}
        />
      </div>

      <footer className="flex shrink-0 justify-between pt-2">
        <button
          type="button"
          disabled={!prev}
          onClick={() => prev && props.onFocus(prev)}
          className="btn btn-ghost h-11"
        >
          ← Prev Set
        </button>
        <button
          type="button"
          disabled={!next}
          onClick={() => next && props.onFocus(next)}
          className="btn btn-ghost h-11"
        >
          Next Exercise →
        </button>
      </footer>
    </section>
  );
}

function Dial({
  spec,
  value,
  disabled,
  hint,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  disabled: boolean;
  /** What the number means for this exercise, e.g. "Input: 1x DB", "per side". */
  hint: string | null;
  onChange: (value: string) => void;
}) {
  const step = STEPS[spec.draftKey];
  const id = `hud-${spec.draftKey}`;
  const hintId = `${id}-hint`;
  return (
    <div className="card flex flex-col gap-2 p-3">
      <label
        htmlFor={id}
        className="text-center text-[11px] font-semibold tracking-wider text-muted uppercase"
      >
        <span className="sr-only">{spec.label}</span>
        <span aria-hidden="true">{CAPTIONS[spec.draftKey] ?? spec.label}</span>
      </label>
      {hint ? (
        <p id={hintId} className="-mt-1 text-center text-xs text-muted" data-load-hint="">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        type={spec.type === "number" ? "number" : "text"}
        inputMode={spec.type === "number" ? spec.inputMode : undefined}
        min={spec.type === "number" ? spec.min : undefined}
        max={spec.type === "number" ? spec.max : undefined}
        step={spec.type === "number" ? (spec.step ?? "1") : undefined}
        maxLength={spec.type === "text" ? 20 : undefined}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-transparent text-center font-mono text-[32px] leading-tight font-bold disabled:text-muted"
      />
      {step ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(stepValue(value, -step.delta, step.min))}
            className="btn btn-secondary h-11 font-mono"
          >
            −{step.delta}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(stepValue(value, step.delta, step.min))}
            className="btn btn-secondary h-11 font-mono"
          >
            +{step.delta}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RirPills({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const selected = rirPillValue(value);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-label="RIR"
        className="grid grid-cols-5 gap-2"
      >
        {RIR_PILLS.map((pill) => {
          const active = pill.value === selected;
          return (
            <button
              key={pill.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(active ? "" : pill.value)}
              className={`h-10 rounded-full border font-mono text-sm font-semibold ${
                active
                  ? "border-warn bg-warn-soft text-warn"
                  : "border-line bg-elevated text-muted"
              }`}
            >
              {pill.label}
            </button>
          );
        })}
      </div>
      <p id="rir-hint" className="text-center text-[11px] text-muted">
        {RIR_HINT}
      </p>
    </div>
  );
}

function RestBar({
  restEndsAt,
  onAdjust,
  onSkip,
}: {
  restEndsAt: string;
  onAdjust: (seconds: number) => void;
  onSkip: () => void;
}) {
  const { remainingSeconds } = useRestCountdown(restEndsAt);
  return (
    <div
      id="active-rest-overlay"
      className="flex h-[54px] items-center gap-2 rounded-[var(--radius-md)] border border-accent bg-accent-soft px-3"
    >
      <p
        id="active-rest-timer"
        role="timer"
        aria-live="polite"
        className="min-w-0 flex-1 font-mono text-[15px] font-bold whitespace-nowrap"
        data-numeric
      >
        RESTING — {formatCountdown(remainingSeconds)}
      </p>
      <button
        type="button"
        id="subtract-rest-time"
        aria-label="−15 seconds"
        onClick={() => onAdjust(-15)}
        className="btn btn-secondary h-10 shrink-0 px-2 font-mono text-xs"
      >
        −15s
      </button>
      <button
        type="button"
        id="add-rest-time"
        aria-label="+15 seconds"
        onClick={() => onAdjust(15)}
        className="btn btn-secondary h-10 shrink-0 px-2 font-mono text-xs"
      >
        +15s
      </button>
      <button
        type="button"
        id="skip-rest"
        onClick={onSkip}
        className="btn btn-primary h-10 shrink-0 px-2 text-xs whitespace-nowrap"
      >
        Skip Rest
      </button>
    </div>
  );
}

/** The thumb zone for one set. Remounted (via key) whenever the shown set or
 * its saved entry changes, so its values always start from the right source. */
function SetPanel({
  row,
  previous,
  allLogged,
  session,
  restWasSkipped,
  feeling,
  onFeelingChange,
  onComplete,
  onSkip,
  onCorrect,
  onUndo,
  onAdjustRest,
  onSkipRest,
  onFinish,
}: WorkoutHudProps & {
  row: HudRow;
  previous: HudRow | null;
  allLogged: boolean;
}) {
  const kind = row.exercise.exercise_kind;
  const specs = FIELD_SPECS_BY_KIND[kind];
  const draftKey = draftStorageKey(session.id, row.exercise.id, row.setNumber);
  const [draft, setDraft] = useState<SetDraft>(() => seedDraft(row, previous));
  const [ready, setReady] = useState(row.entry !== null);
  const [editing, setEditing] = useState(false);
  const [undoVisible, setUndoVisible] = useState(false);
  const { expired } = useRestCountdown(session.rest_ends_at);

  // An unsaved set resumes from its local draft (IndexedDB is async).
  useEffect(() => {
    if (row.entry) {
      void clearSetDraft(activeWorkoutStorage, draftKey);
      return;
    }
    let cancelled = false;
    void loadSetDraft(activeWorkoutStorage, draftKey).then((loaded) => {
      if (cancelled) return;
      if (loaded) setDraft(loaded);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [row.entry, draftKey]);

  // The five-second undo window is measured from the server's completion time.
  useEffect(() => {
    const completedAt = row.entry?.completed_at;
    if (!completedAt) return;
    const remaining =
      UNDO_WINDOW_MS - (Date.now() - new Date(completedAt).getTime());
    if (remaining <= 0) return;
    setUndoVisible(true);
    const handle = window.setTimeout(() => setUndoVisible(false), remaining);
    return () => window.clearTimeout(handle);
  }, [row.entry?.completed_at]);

  function update(key: keyof SetDraft, value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (!row.entry) void saveSetDraft(activeWorkoutStorage, draftKey, next);
  }

  const values = () => draftToValues(kind, draft);
  const locked = !ready || (row.entry !== null && !editing);
  const resting = Boolean(session.rest_ends_at) && !expired;
  const numberSpecs = specs.filter(
    (spec) => spec.draftKey !== "rir" && spec.draftKey !== "band_level",
  );
  const rirSpec = specs.find((spec) => spec.draftKey === "rir");
  const bandSpec = specs.find((spec) => spec.draftKey === "band_level");

  let action: ReactNode;
  if (row.entry && !editing) {
    action = (
      <div className="flex h-[54px] items-center gap-2">
        <span
          className={`flex-1 text-sm font-semibold ${row.state === "skipped" ? "text-warn" : "text-success"}`}
        >
          {row.state === "skipped" ? "Skipped" : "Saved"}
        </span>
        {undoVisible ? (
          <button
            type="button"
            className="btn btn-secondary h-11"
            onClick={() => onUndo(row)}
          >
            Undo
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-secondary h-11"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </div>
    );
  } else if (editing) {
    action = (
      <button
        type="button"
        className="btn btn-primary h-[54px] w-full text-base font-bold"
        onClick={() =>
          void onCorrect(row, values()).then((saved) => {
            if (saved) setEditing(false);
          })
        }
      >
        Save correction
      </button>
    );
  } else if (resting && session.rest_ends_at) {
    action = (
      <RestBar
        restEndsAt={session.rest_ends_at}
        onAdjust={onAdjustRest}
        onSkip={onSkipRest}
      />
    );
  } else {
    action = (
      <button
        type="button"
        disabled={!ready}
        onClick={() => onComplete(row, values())}
        className="h-[54px] w-full rounded-[var(--radius-md)] bg-success text-base font-extrabold tracking-wide text-on-success uppercase disabled:opacity-50"
      >
        <span aria-hidden="true">✓ </span>Complete set &amp; start rest
      </button>
    );
  }

  return (
    <div className="mt-auto flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {numberSpecs.map((spec, specIndex) => (
          <div
            key={spec.draftKey}
            className={
              numberSpecs.length === 3 && specIndex === 2
                ? "col-span-2"
                : undefined
            }
          >
            <Dial
              spec={spec}
              value={draft[spec.draftKey]}
              disabled={locked}
              hint={fieldHint(spec.draftKey, row.exercise)}
              onChange={(value) => update(spec.draftKey, value)}
            />
          </div>
        ))}
      </div>
      {rirSpec ? (
        <RirPills
          value={draft.rir}
          disabled={locked}
          onChange={(value) => update("rir", value)}
        />
      ) : null}
      {bandSpec ? (
        <label className="flex items-center gap-3 text-sm text-muted">
          <span>{bandSpec.label}</span>
          <input
            type="text"
            maxLength={20}
            value={draft.band_level}
            disabled={locked}
            onChange={(event) => update("band_level", event.target.value)}
            className="input flex-1"
          />
        </label>
      ) : null}

      {allLogged ? (
        <div className="flex flex-col gap-2">
          {resting && session.rest_ends_at ? (
            <RestBar
              restEndsAt={session.rest_ends_at}
              onAdjust={onAdjustRest}
              onSkip={onSkipRest}
            />
          ) : null}
          {row.entry && !editing ? action : null}
          {editing ? action : null}
          <label className="field-label mb-0" htmlFor="active-feeling">
            Overall feeling
          </label>
          <ScaleSelect
            id="active-feeling"
            className="input min-h-touch"
            scale={FEELING_SCALE}
            value={feeling}
            onChange={onFeelingChange}
          />
          <button
            type="button"
            id="finish-active-workout"
            onClick={onFinish}
            className="h-[54px] w-full rounded-[var(--radius-md)] bg-success text-base font-extrabold text-on-success"
          >
            Finish workout
          </button>
        </div>
      ) : (
        <>
          {expired && !row.entry ? (
            <p
              id="active-rest-expired"
              role="status"
              className="text-center text-sm font-semibold text-success"
            >
              Rest complete
            </p>
          ) : null}
          {restWasSkipped && !session.rest_ends_at && !row.entry ? (
            <p role="status" className="text-center text-xs text-muted">
              Rest skipped
            </p>
          ) : null}
          {action}
          {!row.entry ? (
            <button
              type="button"
              className="btn btn-ghost h-9 self-center text-xs"
              onClick={() => onSkip(row, values())}
            >
              Skip set
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
