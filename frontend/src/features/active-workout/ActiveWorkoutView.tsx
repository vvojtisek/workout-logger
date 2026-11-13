import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { SessionExercise, WorkoutSession } from "@/api/types";
import { useAppContext } from "@/AppLayout";
import { useExerciseProgression } from "@/features/progression/useExerciseProgression";
import { activeWorkoutStorage } from "@/lib/active-workout-storage";
import { exerciseStatsFacts } from "@/lib/exercise-stats";
import { unlockRestAlertAudio } from "@/lib/rest-alerts";
import {
  adjustQueuedSetRest,
  clearSetDraft,
  draftStorageKey,
  enqueueSetOperation,
  getSetQueue,
  removeSetOperation,
  synchronizationState,
} from "@/lib/active-workout-state";
import type { SetOperation } from "@/lib/active-workout-state";
import { useSettingsQuery } from "@/lib/settings-query";
import {
  applyOptimisticSet,
  applyPendingSets,
  isPendingEntry,
} from "@/lib/optimistic-session";
import { workoutProgress } from "@/lib/workout-utils";
import type { GridRow } from "@/lib/workout-utils";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { DesktopWorkout } from "./DesktopWorkout";
import type { SetValues } from "./SetRow";
import { useIsDesktop } from "@/lib/use-media-query";
import { hudIndex, performanceOrder, projectQueuedSets } from "@/lib/workout-hud";
import { WorkoutHud } from "./WorkoutHud";

export function ActiveWorkoutView() {
  const { session, sessionReady, online, updateSession, finishSession } = useAppContext();
  const hadSessionRef = useRef(false);
  if (session) hadSessionRef.current = true;

  // A direct visit to /workout with no active session has nothing to render;
  // the plans list is where a session is actually started. Once a session has
  // existed, though, finishing it clears local state a render tick before the
  // router's own navigate("/history") lands, and redirecting to /plans here
  // in that window would win the race and hijack the destination — so after
  // finishing, render nothing and let the in-flight navigation land instead.
  if (!session && !hadSessionRef.current) {
    if (sessionReady && online) return <Navigate to="/plans" replace />;
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">
        {sessionReady ? "Reconnect to start a workout." : "Loading workout…"}
      </div>
    );
  }
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
  const [replayOffline, setReplayOffline] = useState(false);
  const [queue, setQueue] = useState<SetOperation[]>([]);
  const [localFocus, setLocalFocus] = useState<{ exerciseId: string; setNumber: number } | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const syncInProgress = useRef(false);
  const syncRequested = useRef(false);
  const replayAllowed = useRef(false);
  const pendingWrites = useRef(new Set<string>());
  const gridRef = useRef<HTMLDivElement>(null);
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();

  const showQueuedSets = !isDesktop && (!online || replayOffline || queue.some((item) => item.captured_offline));
  const projected = showQueuedSets ? projectQueuedSets(session, queue) : { session, rest: null };
  const displaySession = showQueuedSets && localFocus ? {
    ...projected.session,
    focused_exercise_id: localFocus.exerciseId,
    focused_set_number: localFocus.setNumber,
  } : projected.session;
  const progress = workoutProgress(displaySession);
  const sync = synchronizationState(queue, online, syncError);

  // History stats are a read-only aid: a failed or offline fetch just leaves
  // them out and never blocks logging.
  const exerciseNames = [...new Set(session.exercises.map((exercise) => exercise.exercise_name))];
  const { stats: statsByName, ...progression } = useExerciseProgression(exerciseNames, {
    sessionId: session.id,
    enableFilters: isDesktop,
    enabled: online,
  });
  const { data: settings } = useSettingsQuery();

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
    try {
      const all = await getSetQueue(activeWorkoutStorage);
      setQueue(all.filter((operation) => operation.session_id === session.id));
    } catch (error) {
      setSyncError(errorMessage(error));
    }
  }, [session.id]);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    replayAllowed.current = online;
    return () => { replayAllowed.current = false; };
  }, [online]);

  const flushSetQueue = useCallback(async () => {
    if (!replayAllowed.current || !navigator.onLine) return;
    syncRequested.current = true;
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    setSyncError(null);
    try {
      while (syncRequested.current && replayAllowed.current && navigator.onLine) {
        syncRequested.current = false;
        const operations = (await getSetQueue(activeWorkoutStorage)).filter(
          (operation) => operation.session_id === session.id,
        );
        for (const operation of operations) {
          if (!replayAllowed.current || !navigator.onLine) break;
          const updated = await apiFetch<WorkoutSession>(
            `/workout-sessions/${operation.session_id}/sets`,
            { method: "POST", body: JSON.stringify(operation.payload) },
          );
          await removeSetOperation(activeWorkoutStorage, operation.client_operation_id);
          if (operation.draft_key) await clearSetDraft(activeWorkoutStorage, operation.draft_key);
          if (operation.payload.state !== "skipped") setRestWasSkipped(false);
          onSessionChange(updated);
          setReplayOffline(false);
        }
      }
    } catch (err) {
      if (err instanceof TypeError) setReplayOffline(true);
      setSyncError(errorMessage(err));
    } finally {
      syncInProgress.current = false;
      await refreshQueue();
    }
  }, [session.id, onSessionChange, refreshQueue]);

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

  // After a reload (or a crash) with sets still queued, show them as logged
  // again instead of waiting for the network to confirm them.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (restoredFor.current === session.id) return;
    restoredFor.current = session.id;
    void getSetQueue(activeWorkoutStorage).then((all) => {
      const mine = all.filter((operation) => operation.session_id === session.id);
      if (mine.length > 0) onSessionChange(applyPendingSets(session, mine));
    });
  }, [session, onSessionChange]);

  const persistSet = useCallback(
    async (row: GridRow, values: SetValues, state: "completed" | "skipped") => {
      if (state === "completed") unlockRestAlertAudio();
      const draftKey = draftStorageKey(session.id, row.exercise.id, row.setNumber);
      if (pendingWrites.current.has(draftKey)) return;
      pendingWrites.current.add(draftKey);
      try {
        const operationId = crypto.randomUUID();
        const payload = {
            session_exercise_id: row.exercise.id,
            set_number: row.setNumber,
            weight_kg: values.weight,
            reps: values.reps,
            rir: values.rir,
            rpe: values.rpe,
            added_weight_kg: values.added_weight_kg,
            band_level: values.band_level,
            duration_seconds: values.duration_seconds,
            distance_km: values.distance_km,
            incline_percent: values.incline_percent,
            state,
            client_operation_id: operationId,
            client_completed_at: new Date().toISOString(),
        };
        // Optimistic: the set, the rest timer and the next set's focus all update
        // in this frame. Durability and the network follow, never gate the UI.
        onSessionChange(applyOptimisticSet(session, payload));
        await enqueueSetOperation(activeWorkoutStorage, {
          client_operation_id: operationId,
          session_id: session.id,
          draft_key: draftKey,
          captured_offline: !replayAllowed.current || !navigator.onLine || replayOffline,
          payload,
        });
        setLocalFocus(null);
        setSyncError(null);
        await refreshQueue();
        await flushSetQueue();
      } catch (error) {
        onSessionChange(session);
        setSyncError(errorMessage(error));
        toast.error("This device could not save the set. Try logging it again.");
      } finally {
        pendingWrites.current.delete(draftKey);
      }
    },
    [session, onSessionChange, flushSetQueue, refreshQueue, replayOffline]
  );

  const correctSet = useCallback(
    async (row: GridRow, values: SetValues): Promise<boolean> => {
      if (!row.entry) return false;
      if (isPendingEntry(row.entry)) {
        toast.error("This set is still saving. Try again in a moment.");
        return false;
      }
      if (!replayAllowed.current) {
        toast.error("Reconnect to correct a synchronized set.");
        return false;
      }
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
              rpe: values.rpe,
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
      if (!row.entry || isPendingEntry(row.entry)) return;
      if (!replayAllowed.current) {
        toast.error("Reconnect to undo a synchronized set.");
        return;
      }
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
      if (showQueuedSets) {
        setLocalFocus({ exerciseId: row.exercise.id, setNumber: row.setNumber });
        return;
      }
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
    [session.id, onSessionChange, showQueuedSets]
  );

  const updateRest = useCallback(
    async (data: { adjustment_seconds?: number; skip?: boolean }) => {
      try {
        if (projected.rest) {
          if (syncInProgress.current) return;
          const updated = await adjustQueuedSetRest(
            activeWorkoutStorage,
            projected.rest.operationId,
            projected.rest.defaultSeconds,
            data.skip ? null : data.adjustment_seconds ?? 0,
          );
          if (updated) setRestWasSkipped(data.skip === true);
          await refreshQueue();
          // The persistent rest bar reads the app-level session, so hand it the
          // adjusted queued timer too.
          const queued = (await getSetQueue(activeWorkoutStorage)).filter(
            (operation) => operation.session_id === session.id,
          );
          onSessionChange({
            ...session,
            rest_ends_at: projectQueuedSets(session, queued).session.rest_ends_at,
          });
          return;
        }
        if (!replayAllowed.current) return;
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
    [session, onSessionChange, projected.rest, refreshQueue]
  );

  // The persistent rest bar lives in the app shell; it drives the timer through
  // this, so queued (offline) rest adjustments keep working from the bar.
  const { restControls } = useAppContext();
  useEffect(() => {
    restControls.current = updateRest;
    return () => {
      if (restControls.current === updateRest) restControls.current = null;
    };
  }, [restControls, updateRest]);

  async function completeWorkout() {
    try {
      const pending = await getSetQueue(activeWorkoutStorage);
      if (pendingWrites.current.size || pending.some((operation) => operation.session_id === session.id)) {
        toast.error("Synchronize queued sets before finishing.");
        return;
      }
      if (!replayAllowed.current) {
        toast.error("Reconnect to finish the workout.");
        return;
      }
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
    if (queue.length || pendingWrites.current.size) {
      toast.error("Synchronize queued sets before finishing.");
      return;
    }
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
    const hudRows = performanceOrder(displaySession);
    const hudPosition = hudIndex(displaySession, hudRows);
    const shown = hudRows[hudPosition];
    return (
      <>
        <WorkoutHud
          equipmentProfiles={settings?.equipment_profiles ?? []}
          activeEquipmentProfileId={settings?.active_equipment_profile_id ?? "barbell-default"}
          session={displaySession}
          rows={hudRows}
          index={hudPosition}
          progress={progress}
          sync={sync}
          stats={statsByName}
          statsLine={shown ? exerciseStatsLine(shown.exercise as SessionExercise) : null}
          feeling={feeling}
          onFeelingChange={setFeeling}
          onComplete={(target, values) => void persistSet(target, values, "completed")}
          onSkip={(target, values) => void persistSet(target, values, "skipped")}
          onCorrect={correctSet}
          onUndo={(target) => void undoSet(target)}
          onFocus={(target) => void focusSet(target)}
          onRetrySync={() => void flushSetQueue()}
          onFinish={finishWorkout}
          onMinimize={online ? () => void navigate("/") : undefined}
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
        progression={progression}
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
