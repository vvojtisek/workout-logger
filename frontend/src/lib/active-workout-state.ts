export const SET_QUEUE_STORAGE_KEY = "workout_logger_active_set_queue";
const DRAFT_PREFIX = "workout_logger_active_draft";

/** Backed by IndexedDB in the app (see indexeddb-storage.ts) so offline
 * writes survive a reload; a plain in-memory Map satisfies this in tests. */
export interface AsyncStorageLike {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
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
}

export interface SetOperation {
  client_operation_id: string;
  session_id: string;
  draft_key?: string;
  payload: SetOperationPayload;
}

export async function getSetQueue(storage: AsyncStorageLike): Promise<SetOperation[]> {
  try {
    const raw = await storage.getItem(SET_QUEUE_STORAGE_KEY);
    const value: unknown = JSON.parse(raw || "[]");
    return Array.isArray(value) ? (value as SetOperation[]) : [];
  } catch {
    return [];
  }
}

export async function enqueueSetOperation(
  storage: AsyncStorageLike,
  operation: SetOperation
): Promise<SetOperation> {
  const queue = await getSetQueue(storage);
  const existing = queue.find(
    (item) =>
      item.session_id === operation.session_id &&
      item.payload.session_exercise_id === operation.payload.session_exercise_id &&
      item.payload.set_number === operation.payload.set_number
  );
  if (existing) return existing;
  queue.push(operation);
  await storage.setItem(SET_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  return operation;
}

export async function removeSetOperation(
  storage: AsyncStorageLike,
  operationId: string
): Promise<void> {
  const queue = (await getSetQueue(storage)).filter(
    (item) => item.client_operation_id !== operationId
  );
  await storage.setItem(SET_QUEUE_STORAGE_KEY, JSON.stringify(queue));
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
