import type { WorkoutSession } from "@/api/types";
import type { SetOperation, SetOperationPayload } from "./active-workout-state";
import { performanceOrder } from "./workout-hud";
import type { SetEntry } from "./workout-utils";

const PENDING_PREFIX = "pending-";

/** A set that exists only on this device so far, awaiting the server. */
export function isPendingEntry(entry: Pick<SetEntry, "id"> | null | undefined): boolean {
  return Boolean(entry?.id.startsWith(PENDING_PREFIX));
}

/**
 * The session as it will be once a queued set reaches the server: the set is
 * recorded, rest has started and focus has moved on. Applying it the instant
 * the athlete taps means logging never waits on the network. The server's own
 * response later replaces all of this, so nothing here is authoritative.
 *
 * Pure: returns a new session and leaves the input untouched. A set the
 * session already holds is left alone, which makes replaying safe.
 */
export function applyOptimisticSet(
  session: WorkoutSession,
  payload: SetOperationPayload,
  now: Date = new Date(),
): WorkoutSession {
  const target = session.exercises.find(
    (exercise) => exercise.id === payload.session_exercise_id,
  );
  if (!target) return session;
  if (target.set_entries.some((entry) => entry.set_number === payload.set_number)) {
    return session;
  }

  const state = payload.state ?? "completed";
  const entry: SetEntry = {
    id: `${PENDING_PREFIX}${payload.client_operation_id ?? payload.set_number}`,
    set_number: payload.set_number,
    weight_kg: payload.weight_kg,
    reps: payload.reps,
    rir: payload.rir,
    added_weight_kg: payload.added_weight_kg ?? null,
    band_level: payload.band_level ?? null,
    duration_seconds: payload.duration_seconds ?? null,
    distance_km: payload.distance_km ?? null,
    incline_percent: payload.incline_percent ?? null,
    rpe: payload.rpe ?? null,
    state,
    completed_at: now.toISOString(),
    client_operation_id: payload.client_operation_id,
  };

  const exercises = session.exercises.map((exercise) =>
    exercise.id === target.id
      ? { ...exercise, set_entries: [...exercise.set_entries, entry] }
      : exercise,
  );
  const restStarts = state === "completed" && target.rest_time_seconds > 0;
  const next: WorkoutSession = {
    ...session,
    exercises,
    rest_ends_at: restStarts
      ? new Date(now.getTime() + target.rest_time_seconds * 1000).toISOString()
      : session.rest_ends_at,
  };

  // Focus goes to the next open set after this one, else the first open set.
  const rows = performanceOrder(next);
  const at = rows.findIndex(
    (row) => row.exercise.id === target.id && row.setNumber === payload.set_number,
  );
  const open =
    rows.slice(at + 1).find((row) => row.entry === null) ??
    rows.find((row) => row.entry === null);
  if (open) {
    next.focused_exercise_id = open.exercise.id;
    next.focused_set_number = open.setNumber;
  }
  return next;
}

/** Re-applies every queued set of this session, e.g. after a reload while
 * offline, so the screen matches what the athlete already logged. */
export function applyPendingSets(
  session: WorkoutSession,
  queue: SetOperation[],
  now: Date = new Date(),
): WorkoutSession {
  return queue
    .filter((operation) => operation.session_id === session.id)
    .reduce((current, operation) => applyOptimisticSet(current, operation.payload, now), session);
}
