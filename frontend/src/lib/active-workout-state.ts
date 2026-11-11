export const SET_QUEUE_STORAGE_KEY = "workout_logger_active_set_queue";
const DRAFT_PREFIX = "workout_logger_active_draft";

/** Backed by IndexedDB in the app (see indexeddb-storage.ts) so offline
 * writes survive a reload; a plain in-memory Map satisfies this in tests. */
export interface AsyncStorageLike {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  updateItem: <T>(
    key: string,
    update: (stored: string | null) => { value: string; result: T },
  ) => Promise<T>;
}

export interface RestTimerState {
  status: "inactive" | "active" | "expired";
  remainingSeconds: number;
  label: string;
}

export function restTimerState(restEndsAt: string | null, now: Date = new Date()): RestTimerState {
  if (!restEndsAt) {
    return { status: "inactive", remainingSeconds: 0, label: "Rest not started" };
  }
  const remainingSeconds = Math.max(
    0,
    Math.ceil((new Date(restEndsAt).getTime() - now.getTime()) / 1000)
  );
  if (remainingSeconds === 0) {
    return { status: "expired", remainingSeconds: 0, label: "Rest complete" };
  }
  return { status: "active", remainingSeconds, label: `Rest: ${remainingSeconds}s` };
}

export function adjustedRemainingSeconds(
  restEndsAt: string,
  adjustmentSeconds: number,
  now: Date = new Date()
): number {
  const remaining = Math.ceil((new Date(restEndsAt).getTime() - now.getTime()) / 1000);
  return Math.max(0, remaining + adjustmentSeconds);
}

export function draftStorageKey(sessionId: string, exerciseId: string, setNumber: number): string {
  return `${DRAFT_PREFIX}:${sessionId}:${exerciseId}:${setNumber}`;
}

export interface SetDraft {
  weight: string;
  reps: string;
  rir: string;
  rpe?: string;
  added_weight_kg: string;
  band_level: string;
  duration_seconds: string;
  distance_km: string;
  incline_percent: string;
}

export async function saveSetDraft(
  storage: AsyncStorageLike,
  key: string,
  draft: SetDraft
): Promise<void> {
  await storage.setItem(key, JSON.stringify(draft));
}

export async function loadSetDraft(
  storage: AsyncStorageLike,
  key: string
): Promise<SetDraft | null> {
  const value = await storage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as SetDraft;
  } catch {
    await storage.removeItem(key);
    return null;
  }
}

export async function clearSetDraft(storage: AsyncStorageLike, key: string): Promise<void> {
  await storage.removeItem(key);
}

export interface SetOperationPayload {
  session_exercise_id?: string;
  set_number: number;
  weight_kg: number | null;
  reps: number;
  rir: number | null;
  added_weight_kg?: number | null;
  band_level?: string | null;
  duration_seconds?: number | null;
  distance_km?: number | null;
  incline_percent?: number | null;
  rpe?: number | null;
  state?: string;
  client_operation_id?: string;
  client_completed_at?: string;
  client_rest_seconds?: number;
}

export interface SetOperation {
  client_operation_id: string;
  session_id: string;
  draft_key?: string;
  captured_offline?: boolean;
  payload: SetOperationPayload;
}

function decodeSetQueue(raw: string | null): SetOperation[] {
  const value: unknown = JSON.parse(raw ?? "[]");
  if (!Array.isArray(value)) throw new Error("The saved set queue is unreadable.");
  return value as SetOperation[];
}

export async function getSetQueue(storage: AsyncStorageLike): Promise<SetOperation[]> {
  return decodeSetQueue(await storage.getItem(SET_QUEUE_STORAGE_KEY));
}

export async function enqueueSetOperation(
  storage: AsyncStorageLike,
  operation: SetOperation
): Promise<SetOperation> {
  return storage.updateItem(SET_QUEUE_STORAGE_KEY, (stored) => {
    const queue = decodeSetQueue(stored);
    const existing = queue.find(
      (item) =>
        item.session_id === operation.session_id &&
        item.payload.session_exercise_id === operation.payload.session_exercise_id &&
        item.payload.set_number === operation.payload.set_number,
    );
    if (existing) return { value: JSON.stringify(queue), result: existing };
    queue.push(operation);
    return { value: JSON.stringify(queue), result: operation };
  });
}

export async function removeSetOperation(
  storage: AsyncStorageLike,
  operationId: string
): Promise<void> {
  await storage.updateItem(SET_QUEUE_STORAGE_KEY, (stored) => {
    const queue = decodeSetQueue(stored).filter((item) => item.client_operation_id !== operationId);
    return { value: JSON.stringify(queue), result: undefined };
  });
}

export async function adjustQueuedSetRest(
  storage: AsyncStorageLike,
  operationId: string,
  defaultSeconds: number,
  adjustmentSeconds: number | null,
): Promise<boolean> {
  return storage.updateItem(SET_QUEUE_STORAGE_KEY, (stored) => {
    const queue = decodeSetQueue(stored);
    const operation = queue.find((item) => item.client_operation_id === operationId);
    if (!operation) return { value: stored ?? "[]", result: false };
    const current = operation.payload.client_rest_seconds ?? defaultSeconds;
    operation.payload.client_rest_seconds = adjustmentSeconds === null
      ? 0
      : Math.max(0, Math.min(3600, current + adjustmentSeconds));
    return { value: JSON.stringify(queue), result: true };
  });
}

export interface SynchronizationState {
  status: "failed" | "pending" | "synchronized";
  label: string;
}

export function synchronizationState(
  queue: SetOperation[],
  online: boolean,
  error: string | null
): SynchronizationState {
  if (error) return { status: "failed", label: "Synchronization failed" };
  if (!online && queue.length > 0) {
    return { status: "pending", label: "Pending synchronization" };
  }
  if (queue.length > 0) return { status: "pending", label: "Pending synchronization" };
  return { status: "synchronized", label: "Synchronized" };
}
