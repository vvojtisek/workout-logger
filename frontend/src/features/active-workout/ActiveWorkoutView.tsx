import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { ExerciseStatsResponse, SessionExercise, WorkoutSession } from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { activeWorkoutStorage } from "@/lib/active-workout-storage";
import { exerciseStatsFacts } from "@/lib/exercise-stats";
import {
  clearSetDraft,
  draftStorageKey,
  enqueueSetOperation,
  getSetQueue,
  removeSetOperation,
  synchronizationState,
} from "@/lib/active-workout-state";
import type { SetOperation } from "@/lib/active-workout-state";
import { workoutProgress } from "@/lib/workout-utils";
import type { GridRow } from "@/lib/workout-utils";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { DesktopWorkout } from "./DesktopWorkout";
import type { SetValues } from "./SetRow";
import { useIsDesktop } from "@/lib/use-media-query";
import { hudIndex, performanceOrder } from "@/lib/workout-hud";
import { WorkoutHud } from "./WorkoutHud";

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
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();

  const progress = workoutProgress(session);
  const sync = synchronizationState(queue, online, syncError);

  // History stats are a read-only aid: a failed or offline fetch just leaves
  // them out and never blocks logging.
  const exerciseNames = [...new Set(session.exercises.map((exercise) => exercise.exercise_name))];
  const { data: statsResponse } = useQuery({
    // A swap renames an exercise, so the names are part of the key.
    queryKey: ["exercise-stats", session.id, ...exerciseNames],
    queryFn: () => {
      const params = new URLSearchParams();
      for (const name of exerciseNames) params.append("name", name);
      return apiFetch<ExerciseStatsResponse>(`/exercise-stats?${params.toString()}`);
    },
    enabled: exerciseNames.length > 0,
    staleTime: Infinity,
    retry: false,
  });
  const statsByName = new Map(
    (statsResponse?.items ?? []).map((item) => [item.exercise_name, item])
  );

  function exerciseStatsLine(exercise: SessionExercise) {
    const facts = exerciseStatsFacts(statsByName.get(exercise.exercise_name));
    if (facts.length === 0) return null;
    return (
      <p className="exercise-stats text-xs text-muted" data-numeric>
        {facts.join(" · ")}
      </p>
    );
  }

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

  // Move the caret to the set the athlete is meant to fill in next - but
  // never steal it away from a field they (or an in-flight fill) are
  // already interacting with. Every set completion anywhere in the grid
  // replaces `session`, re-running this effect; without the active-element
  // check it can yank focus onto the newly "current" set's input mid-type,
  // landing keystrokes meant for the row being completed onto that other
  // row instead.
  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      const activeTag = active?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
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
    async (row: GridRow, values: SetValues): Promise<boolean> => {
      if (!row.entry) return false;
      if (!Number.isInteger(values.reps) || values.reps < 1) {
        toast.error("Enter a whole number of reps before saving the correction.");
        return false;
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
        return true;
      } catch (err) {
        toast.error(`Failed to save correction: ${errorMessage(err)}`);
        return false;
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

  const confirmDialog = (
    <ConfirmDialog
      open={confirmFinish}
      onClose={() => setConfirmFinish(false)}
      onConfirm={() => void completeWorkout()}
      title="Finish incomplete workout?"
      message="Not every set has been logged yet. Finish anyway?"
      confirmLabel="Finish workout"
      confirmVariant="primary"
    />
  );

  if (!isDesktop) {
    const hudRows = performanceOrder(session);
    const shown = hudRows[hudIndex(session, hudRows)];
    return (
      <>
        <WorkoutHud
          session={session}
          rows={hudRows}
          index={hudIndex(session, hudRows)}
          progress={progress}
          sync={sync}
          restWasSkipped={restWasSkipped}
          stats={statsByName}
          statsLine={shown ? exerciseStatsLine(shown.exercise as SessionExercise) : null}
          feeling={feeling}
          onFeelingChange={setFeeling}
          onComplete={(target, values) => void persistSet(target, values, "completed")}
          onSkip={(target, values) => void persistSet(target, values, "skipped")}
          onCorrect={correctSet}
          onUndo={(target) => void undoSet(target)}
          onFocus={(target) => void focusSet(target)}
          onAdjustRest={(seconds) => void updateRest({ adjustment_seconds: seconds })}
          onSkipRest={() => void updateRest({ skip: true })}
          onRetrySync={() => void flushSetQueue()}
          onFinish={finishWorkout}
          onMinimize={() => void navigate("/plans")}
        />
        {confirmDialog}
      </>
    );
  }

  const desktopRows = performanceOrder(session);
  return (
    <>
      <DesktopWorkout
        session={session}
        rows={desktopRows}
        index={hudIndex(session, desktopRows)}
        progress={progress}
        sync={sync}
        restWasSkipped={restWasSkipped}
        stats={statsByName}
        statsLine={exerciseStatsLine}
        gridRef={gridRef}
        feeling={feeling}
        onFeelingChange={setFeeling}
        onComplete={(target, values) => void persistSet(target, values, "completed")}
        onSkip={(target, values) => void persistSet(target, values, "skipped")}
        onCorrect={correctSet}
        onUndo={(target) => void undoSet(target)}
        onFocus={(target) => void focusSet(target)}
        onAdjustRest={(seconds) => void updateRest({ adjustment_seconds: seconds })}
        onSkipRest={() => void updateRest({ skip: true })}
        onRetrySync={() => void flushSetQueue()}
        onFinish={finishWorkout}
        onSessionChange={onSessionChange}
      />
      {confirmDialog}
    </>
  );
}
