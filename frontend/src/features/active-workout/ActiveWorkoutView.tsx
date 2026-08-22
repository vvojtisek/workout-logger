import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { SessionExercise, WorkoutSession } from "@/api/types";
import {
  clearSetDraft,
  draftStorageKey,
  enqueueSetOperation,
  getSetQueue,
  removeSetOperation,
  synchronizationState,
} from "@/lib/active-workout-state";
import { buildWorkoutGrid, groupSessionExercises, workoutProgress } from "@/lib/workout-utils";
import type { GridRow } from "@/lib/workout-utils";
import { RestOverlay } from "./RestOverlay";
import { SetRow } from "./SetRow";
import type { SetValues } from "./SetRow";

const COLUMN_HEADERS = ["Set", "Previous", "kg", "Reps", "RIR", "Complete"];
const HEADER_GRID =
  "grid grid-cols-[3rem_5rem_repeat(3,minmax(4rem,1fr))_minmax(7rem,auto)] gap-2 min-w-[38rem]";

export function ActiveWorkoutView({
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
  const [queueToken, setQueueToken] = useState(0);
  const syncInProgress = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const progress = workoutProgress(session);
  const groups = groupSessionExercises(session.exercises);
  const rows = buildWorkoutGrid(session);
  const sync = synchronizationState(
    getSetQueue(localStorage).filter((operation) => operation.session_id === session.id),
    online,
    syncError
  );
  void queueToken; // queue lives in localStorage; this token forces a re-read

  const flushSetQueue = useCallback(async () => {
    if (syncInProgress.current || !navigator.onLine) return;
    const operations = getSetQueue(localStorage).filter(
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
        removeSetOperation(localStorage, operation.client_operation_id);
        if (operation.draft_key) clearSetDraft(localStorage, operation.draft_key);
        if (operation.payload.state !== "skipped") setRestWasSkipped(false);
      }
      onSessionChange(latest);
    } catch (err) {
      setSyncError(errorMessage(err));
    } finally {
      syncInProgress.current = false;
      setQueueToken((token) => token + 1);
    }
  }, [session, onSessionChange]);

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
      enqueueSetOperation(localStorage, {
        client_operation_id: operationId,
        session_id: session.id,
        draft_key: draftKey,
        payload: {
          session_exercise_id: row.exercise.id,
          set_number: row.setNumber,
          weight_kg: values.weight,
          reps: values.reps,
          rir: values.rir,
          state,
          client_operation_id: operationId,
        },
      });
      setSyncError(null);
      setQueueToken((token) => token + 1);
      await flushSetQueue();
    },
    [session.id, flushSetQueue]
  );

  const correctSet = useCallback(
    async (row: GridRow, values: SetValues) => {
      if (!row.entry) return;
      const updated = await apiFetch<WorkoutSession>(
        `/workout-sessions/${session.id}/sets/${row.entry.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ weight_kg: values.weight, reps: values.reps, rir: values.rir }),
        }
      );
      onSessionChange(updated);
    },
    [session.id, onSessionChange]
  );

  const undoSet = useCallback(
    async (row: GridRow) => {
      if (!row.entry) return;
      const updated = await apiFetch<WorkoutSession>(
        `/workout-sessions/${session.id}/sets/${row.entry.id}`,
        { method: "DELETE" }
      );
      onSessionChange(updated);
    },
    [session.id, onSessionChange]
  );

  const focusSet = useCallback(
    async (row: GridRow) => {
      const updated = await apiFetch<WorkoutSession>(`/workout-sessions/${session.id}/focus`, {
        method: "PATCH",
        body: JSON.stringify({
          session_exercise_id: row.exercise.id,
          set_number: row.setNumber,
        }),
      });
      onSessionChange(updated);
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
        window.alert(`Failed to update rest timer: ${errorMessage(err)}`);
      }
    },
    [session.id, session.version, onSessionChange]
  );

  async function finishWorkout() {
    if (
      progress.done < progress.total &&
      !window.confirm("Finish this incomplete workout?")
    ) {
      return;
    }
    try {
      await apiFetch(`/workout-sessions/${session.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ overall_feeling: Number.parseInt(feeling, 10) }),
      });
      onFinished();
    } catch (err) {
      window.alert(`Failed to finish workout: ${errorMessage(err)}`);
    }
  }

  function renderExercise(exercise: SessionExercise) {
    return (
      <section key={exercise.id}>
        <h3 className="p-3 text-lg font-semibold tracking-tight">{exercise.exercise_name}</h3>
        <div className="overflow-x-auto px-3 pb-2">
          <div className={`${HEADER_GRID} text-xs font-semibold text-muted`}>
            {COLUMN_HEADERS.map((label) => (
              <span key={label} role="columnheader">
                {label}
              </span>
            ))}
          </div>
          {rows
            .filter((row) => row.exercise.id === exercise.id)
            .map((row) => (
              <SetRow
                key={`${exercise.id}:${row.setNumber}`}
                row={row}
                sessionId={session.id}
                totalSets={progress.total}
                onComplete={(target, values) => void persistSet(target, values, "completed")}
                onSkip={(target, values) => void persistSet(target, values, "skipped")}
                onCorrect={(target, values) => void correctSet(target, values)}
                onUndo={(target) => void undoSet(target)}
                onFocusSet={(target) => void focusSet(target)}
              />
            ))}
        </div>
      </section>
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
          onClick={() => void finishWorkout()}
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
              {group.exercises.map((exercise) => renderExercise(exercise as SessionExercise))}
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
    </section>
  );
}
