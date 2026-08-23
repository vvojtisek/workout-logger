import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { SessionExercise, WorkoutSession } from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { activeWorkoutStorage } from "@/lib/active-workout-storage";
import {
  clearSetDraft,
  draftStorageKey,
  enqueueSetOperation,
  getSetQueue,
  removeSetOperation,
  synchronizationState,
} from "@/lib/active-workout-state";
import type { SetOperation } from "@/lib/active-workout-state";
import {
  buildGroupRounds,
  buildWorkoutGrid,
  groupSessionExercises,
  workoutProgress,
} from "@/lib/workout-utils";
import type { ExerciseGroup, GridRow } from "@/lib/workout-utils";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { RestOverlay } from "./RestOverlay";
import { COLUMN_HEADERS_BY_KIND, ROW_GRID, SetRow } from "./SetRow";
import type { SetValues } from "./SetRow";

// Shared verbatim with SetRow's own grid template - see the comment there.
const HEADER_GRID = ROW_GRID;
const ROUND_LETTERS = "ABCDEFGHIJ";

export function ActiveWorkoutView() {
  const { session, online, updateSession, finishSession } = useAppContext();
  const hadSessionRef = useRef(false);
  if (session) hadSessionRef.current = true;

  // A direct visit to /workout with no active session has nothing to render;
  // the plans list is where a session is actually started. Once a session has
  // existed, though, finishing it clears local state a render tick before the
  // router's own navigate("/history") lands, and redirecting to /plans here
  // in that window would win the race and hijack the destination — so after
  // finishing, render nothing and let the in-flight navigation land instead.
  if (!session && !hadSessionRef.current) return <Navigate to="/plans" replace />;
  if (!session) return null;

  return (
    <ActiveWorkoutSession
      session={session}
      online={online}
      onSessionChange={updateSession}
      onFinished={finishSession}
    />
  );
}

function ActiveWorkoutSession({
  session,
  online,
  onSessionChange,
  onFinished,
}: {
  session: WorkoutSession;
  online: boolean;
  onSessionChange: (session: WorkoutSession) => void;
  onFinished: () => void;
}) {
  const [feeling, setFeeling] = useState("3");
  const [restWasSkipped, setRestWasSkipped] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [queue, setQueue] = useState<SetOperation[]>([]);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const syncInProgress = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const progress = workoutProgress(session);
  const groups = groupSessionExercises(session.exercises);
  const rows = buildWorkoutGrid(session);
  const sync = synchronizationState(queue, online, syncError);

  // The queue lives in IndexedDB (async), so it can't be read inline during
  // render like the old localStorage version - this keeps a mirror of it in
  // state instead, refreshed after every write.
  const refreshQueue = useCallback(async () => {
    const all = await getSetQueue(activeWorkoutStorage);
    setQueue(all.filter((operation) => operation.session_id === session.id));
  }, [session.id]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  const flushSetQueue = useCallback(async () => {
    if (syncInProgress.current || !navigator.onLine) return;
    const operations = (await getSetQueue(activeWorkoutStorage)).filter(
      (operation) => operation.session_id === session.id
    );
    if (operations.length === 0) {
      setSyncError(null);
      return;
    }
    syncInProgress.current = true;
    setSyncError(null);
    try {
      let latest = session;
      for (const operation of operations) {
        latest = await apiFetch<WorkoutSession>(
          `/workout-sessions/${operation.session_id}/sets`,
          { method: "POST", body: JSON.stringify(operation.payload) }
        );
        await removeSetOperation(activeWorkoutStorage, operation.client_operation_id);
        if (operation.draft_key) await clearSetDraft(activeWorkoutStorage, operation.draft_key);
        if (operation.payload.state !== "skipped") setRestWasSkipped(false);
      }
      onSessionChange(latest);
    } catch (err) {
      setSyncError(errorMessage(err));
    } finally {
      syncInProgress.current = false;
      await refreshQueue();
    }
  }, [session, onSessionChange, refreshQueue]);

  // Reconnecting must drain anything queued while the network was gone.
  useEffect(() => {
    if (online) void flushSetQueue();
  }, [online, flushSetQueue]);

  // Move the caret to the set the athlete is meant to fill in next.
  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLInputElement>('[data-state="current"] input:not(:disabled)')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [session]);

  const persistSet = useCallback(
    async (row: GridRow, values: SetValues, state: "completed" | "skipped") => {
      const operationId = crypto.randomUUID();
      const draftKey = draftStorageKey(session.id, row.exercise.id, row.setNumber);
      await enqueueSetOperation(activeWorkoutStorage, {
        client_operation_id: operationId,
        session_id: session.id,
        draft_key: draftKey,
        payload: {
          session_exercise_id: row.exercise.id,
          set_number: row.setNumber,
          weight_kg: values.weight,
          reps: values.reps,
          rir: values.rir,
          added_weight_kg: values.added_weight_kg,
          band_level: values.band_level,
          duration_seconds: values.duration_seconds,
          distance_km: values.distance_km,
          incline_percent: values.incline_percent,
          state,
          client_operation_id: operationId,
        },
      });
      setSyncError(null);
      await refreshQueue();
      await flushSetQueue();
    },
    [session.id, flushSetQueue, refreshQueue]
  );

  const correctSet = useCallback(
    async (row: GridRow, values: SetValues) => {
      if (!row.entry) return;
      if (!Number.isInteger(values.reps) || values.reps < 1) {
        toast.error("Enter a whole number of reps before saving the correction.");
        return;
      }
      try {
        const updated = await apiFetch<WorkoutSession>(
          `/workout-sessions/${session.id}/sets/${row.entry.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              weight_kg: values.weight,
              reps: values.reps,
              rir: values.rir,
              added_weight_kg: values.added_weight_kg,
              band_level: values.band_level,
              duration_seconds: values.duration_seconds,
              distance_km: values.distance_km,
              incline_percent: values.incline_percent,
            }),
          }
        );
        onSessionChange(updated);
      } catch (err) {
        toast.error(`Failed to save correction: ${errorMessage(err)}`);
      }
    },
    [session.id, onSessionChange]
  );

  const undoSet = useCallback(
    async (row: GridRow) => {
      if (!row.entry) return;
      try {
        const updated = await apiFetch<WorkoutSession>(
          `/workout-sessions/${session.id}/sets/${row.entry.id}`,
          { method: "DELETE" }
        );
        onSessionChange(updated);
      } catch (err) {
        toast.error(`Failed to undo set: ${errorMessage(err)}`);
      }
    },
    [session.id, onSessionChange]
  );

  const focusSet = useCallback(
    async (row: GridRow) => {
      try {
        const updated = await apiFetch<WorkoutSession>(`/workout-sessions/${session.id}/focus`, {
          method: "PATCH",
          body: JSON.stringify({
            session_exercise_id: row.exercise.id,
            set_number: row.setNumber,
          }),
        });
        onSessionChange(updated);
      } catch (err) {
        toast.error(`Failed to focus set: ${errorMessage(err)}`);
      }
    },
    [session.id, onSessionChange]
  );

  const updateRest = useCallback(
    async (data: { adjustment_seconds?: number; skip?: boolean }) => {
      try {
        const updated = await apiFetch<WorkoutSession>(`/workout-sessions/${session.id}/rest`, {
          method: "PATCH",
          body: JSON.stringify({ ...data, expected_version: session.version }),
        });
        setRestWasSkipped(data.skip === true);
        onSessionChange(updated);
      } catch (err) {
        toast.error(`Failed to update rest timer: ${errorMessage(err)}`);
      }
    },
    [session.id, session.version, onSessionChange]
  );

  async function completeWorkout() {
    try {
      await apiFetch(`/workout-sessions/${session.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ overall_feeling: Number.parseInt(feeling, 10) }),
      });
      onFinished();
    } catch (err) {
      toast.error(`Failed to finish workout: ${errorMessage(err)}`);
    }
  }

  function finishWorkout() {
    if (progress.done < progress.total) {
      setConfirmFinish(true);
      return;
    }
    void completeWorkout();
  }

  function columnHeaderFor(exercise: SessionExercise) {
    return (
      <div className={`${HEADER_GRID} text-xs font-semibold text-muted`}>
        {COLUMN_HEADERS_BY_KIND[exercise.exercise_kind].map((label) => (
          <span key={label} role="columnheader">
            {label}
          </span>
        ))}
      </div>
    );
  }

  function setRowProps() {
    return {
      sessionId: session.id,
      totalSets: progress.total,
      onComplete: (target: GridRow, values: SetValues) =>
        void persistSet(target, values, "completed"),
      onSkip: (target: GridRow, values: SetValues) => void persistSet(target, values, "skipped"),
      onCorrect: (target: GridRow, values: SetValues) => void correctSet(target, values),
      onUndo: (target: GridRow) => void undoSet(target),
      onFocusSet: (target: GridRow) => void focusSet(target),
    };
  }

  function renderExercise(exercise: SessionExercise) {
    return (
      <section key={exercise.id}>
        <h3 className="p-3 text-lg font-semibold tracking-tight">{exercise.exercise_name}</h3>
        <div className="overflow-x-auto px-3 pb-2">
          {columnHeaderFor(exercise)}
          {rows
            .filter((row) => row.exercise.id === exercise.id)
            .map((row) => (
              <SetRow
                key={`${exercise.id}:${row.setNumber}`}
                row={row}
                {...setRowProps()}
              />
            ))}
        </div>
      </section>
    );
  }

  // A real superset is performed back-to-back across exercises, not one
  // exercise's sets to completion before the next - so its rows interleave
  // by round ("1A", "1B", "2A", "2B", ...) instead of each exercise getting
  // its own sequential block. Every exercise still gets exactly one heading
  // (labelled with its round letter) so it stays identifiable while collapsed
  // or scrolled past. The column header assumes every exercise in the group
  // shares one kind, since a mixed-kind superset has no single column set.
  function renderSuperset(group: ExerciseGroup) {
    const exercises = group.exercises as SessionExercise[];
    return (
      <>
        <div className="flex flex-col gap-1 px-3 pt-2">
          {exercises.map((exercise, index) => (
            <h3 key={exercise.id} className="text-base font-semibold tracking-tight">
              {ROUND_LETTERS[index] ?? index}: {exercise.exercise_name}
            </h3>
          ))}
        </div>
        <div className="overflow-x-auto px-3 pb-2">
          {columnHeaderFor(exercises[0])}
          {buildGroupRounds(rows, group.exercises).map((row) => (
            <SetRow
              key={`${row.exercise.id}:${row.setNumber}`}
              row={row}
              roundLabel={row.roundLabel}
              {...setRowProps()}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <section id="active-workout-view">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p id="active-plan-name" className="text-sm text-muted">
            {session.source_plan_name}
          </p>
          <h2 className="text-xl font-semibold tracking-tight">Active Workout</h2>
          <p id="active-progress-text" className="text-sm font-medium" data-numeric>
            {progress.done} of {progress.total} sets
          </p>
        </div>
        <button
          type="button"
          id="finish-active-workout"
          onClick={finishWorkout}
          className="btn btn-secondary btn-touch"
        >
          Finish workout
        </button>
      </div>

      <progress id="active-progress" className="mb-4 w-full" max={100} value={progress.percent} />

      <div id="active-grid" ref={gridRef} className="flex flex-col gap-3">
        {groups.map((group) =>
          group.label ? (
            <details
              key={group.key}
              open
              role="group"
              aria-label={group.label}
              className="card overflow-hidden"
            >
              <summary className="cursor-pointer p-3 font-semibold" style={{ minHeight: "var(--touch)" }}>
                {group.label}
              </summary>
              {group.exercises.length > 1
                ? renderSuperset(group)
                : group.exercises.map((exercise) => renderExercise(exercise as SessionExercise))}
            </details>
          ) : (
            <article key={group.key} className="card overflow-hidden">
              {renderExercise(group.exercises[0] as SessionExercise)}
            </article>
          )
        )}
      </div>

      <footer className="card mt-3 p-4">
        <label className="field-label" htmlFor="active-feeling">
          Overall feeling
        </label>
        <select
          id="active-feeling"
          className="input min-h-touch"
          value={feeling}
          onChange={(event) => setFeeling(event.target.value)}
        >
          {["1", "2", "3", "4", "5"].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </footer>

      <RestOverlay
        restEndsAt={session.rest_ends_at}
        restWasSkipped={restWasSkipped}
        sync={sync}
        onAdjust={(seconds) => void updateRest({ adjustment_seconds: seconds })}
        onSkip={() => void updateRest({ skip: true })}
        onRetrySync={() => void flushSetQueue()}
      />

      <ConfirmDialog
        open={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        onConfirm={() => void completeWorkout()}
        title="Finish incomplete workout?"
        message="Not every set has been logged yet. Finish anyway?"
        confirmLabel="Finish workout"
        confirmVariant="primary"
      />
    </section>
  );
}
