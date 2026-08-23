import { describe, expect, it } from "vitest";

import {
  adjustedRemainingSeconds,
  clearSetDraft,
  draftStorageKey,
  enqueueSetOperation,
  getSetQueue,
  loadSetDraft,
  removeSetOperation,
  restTimerState,
  saveSetDraft,
  synchronizationState,
} from "./active-workout-state";

function memoryStorage() {
  /** @type {Map<string, string>} */
  const values = new Map();
  /** @param {string} key */
  async function getItem(key) {
    return values.get(key) ?? null;
  }
  /** @param {string} key @param {string} value */
  async function setItem(key, value) {
    values.set(key, value);
  }
  /** @param {string} key */
  async function removeItem(key) {
    values.delete(key);
  }
  return { getItem, setItem, removeItem };
}

describe("absolute rest timer state", () => {
  const deadline = "2026-08-22T10:01:30.000Z";

  it("recovers from the same deadline after clock advancement", () => {
    expect(restTimerState(deadline, new Date("2026-08-22T10:00:00.000Z"))).toEqual({
      status: "active",
      remainingSeconds: 90,
      label: "Rest: 90s",
    });
    expect(restTimerState(deadline, new Date("2026-08-22T10:01:31.000Z"))).toEqual({
      status: "expired",
      remainingSeconds: 0,
      label: "Rest complete",
    });
  });

  it("never adjusts below zero", () => {
    const now = new Date("2026-08-22T10:00:00.000Z");
    expect(adjustedRemainingSeconds(deadline, 30, now)).toBe(120);
    expect(adjustedRemainingSeconds(deadline, -120, now)).toBe(0);
  });
});

describe("active set drafts", () => {
  it("persists and clears kg, reps, and RIR by session set", async () => {
    const storage = memoryStorage();
    const key = draftStorageKey("session-a", "exercise-a", 2);
    const draft = {
      weight: "82.75",
      reps: "7",
      rir: "1",
      added_weight_kg: "",
      band_level: "",
      duration_seconds: "",
      distance_km: "",
      incline_percent: "",
    };

    await saveSetDraft(storage, key, draft);
    expect(await loadSetDraft(storage, key)).toEqual(draft);
    await clearSetDraft(storage, key);
    expect(await loadSetDraft(storage, key)).toBeNull();
  });
});

describe("active set synchronization queue", () => {
  it("retains one stable operation and moves through pending, failed, and synchronized", async () => {
    const storage = memoryStorage();
    const operation = {
      client_operation_id: "operation-a",
      session_id: "session-a",
      payload: { set_number: 2, weight_kg: 82.75, reps: 7, rir: 1 },
    };

    await enqueueSetOperation(storage, operation);
    await enqueueSetOperation(storage, operation);
    const queued = await getSetQueue(storage);
    expect(queued).toEqual([operation]);
    expect(synchronizationState(queued, false, null)).toEqual({
      status: "pending",
      label: "Pending synchronization",
    });
    expect(synchronizationState(queued, true, "network failed")).toEqual({
      status: "failed",
      label: "Synchronization failed",
    });

    await removeSetOperation(storage, "operation-a");
    expect(synchronizationState(await getSetQueue(storage), true, null)).toEqual({
      status: "synchronized",
      label: "Synchronized",
    });
  });
});
