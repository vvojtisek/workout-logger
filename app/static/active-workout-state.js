"use strict";

export const SET_QUEUE_STORAGE_KEY = "workout_logger_active_set_queue";
const DRAFT_PREFIX = "workout_logger_active_draft";

/** @typedef {{getItem: (key: string) => string | null, setItem: (key: string, value: string) => unknown, removeItem: (key: string) => unknown}} StorageLike */

/** @param {string | null} restEndsAt @param {Date} now */
export function restTimerState(restEndsAt, now = new Date()) {
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

/** @param {string} restEndsAt @param {number} adjustmentSeconds @param {Date} now */
export function adjustedRemainingSeconds(restEndsAt, adjustmentSeconds, now = new Date()) {
  const remaining = Math.ceil((new Date(restEndsAt).getTime() - now.getTime()) / 1000);
  return Math.max(0, remaining + adjustmentSeconds);
}

/** @param {string} sessionId @param {string} exerciseId @param {number} setNumber */
export function draftStorageKey(sessionId, exerciseId, setNumber) {
  return `${DRAFT_PREFIX}:${sessionId}:${exerciseId}:${setNumber}`;
}

/** @param {StorageLike} storage @param {string} key @param {{weight: string, reps: string, rir: string}} draft */
export function saveSetDraft(storage, key, draft) {
  storage.setItem(key, JSON.stringify(draft));
}

/** @param {StorageLike} storage @param {string} key */
export function loadSetDraft(storage, key) {
  const value = storage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    storage.removeItem(key);
    return null;
  }
}

/** @param {StorageLike} storage @param {string} key */
export function clearSetDraft(storage, key) {
  storage.removeItem(key);
}

/**
 * @typedef {{
 *   client_operation_id: string,
 *   session_id: string,
 *   draft_key?: string,
 *   payload: {session_exercise_id?: string, set_number: number, weight_kg: number | null, reps: number, rir: number | null, state?: string, client_operation_id?: string}
 * }} SetOperation
 */

/** @param {StorageLike} storage @returns {SetOperation[]} */
export function getSetQueue(storage) {
  try {
    const value = JSON.parse(storage.getItem(SET_QUEUE_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** @param {StorageLike} storage @param {SetOperation} operation */
export function enqueueSetOperation(storage, operation) {
  const queue = getSetQueue(storage);
  const existing = queue.find(
    (item) =>
      item.session_id === operation.session_id &&
      item.payload.session_exercise_id === operation.payload.session_exercise_id &&
      item.payload.set_number === operation.payload.set_number
  );
  if (existing) return existing;
  queue.push(operation);
  storage.setItem(SET_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  return operation;
}

/** @param {StorageLike} storage @param {string} operationId */
export function removeSetOperation(storage, operationId) {
  const queue = getSetQueue(storage).filter(
    (item) => item.client_operation_id !== operationId
  );
  storage.setItem(SET_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

/** @param {SetOperation[]} queue @param {boolean} online @param {string | null} error */
export function synchronizationState(queue, online, error) {
  if (error) return { status: "failed", label: "Synchronization failed" };
  if (!online && queue.length > 0) {
    return { status: "pending", label: "Pending synchronization" };
  }
  if (queue.length > 0) return { status: "pending", label: "Pending synchronization" };
  return { status: "synchronized", label: "Synchronized" };
}
