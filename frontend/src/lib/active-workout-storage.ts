import { createIndexedDbStorage } from "./indexeddb-storage";
import type { WorkoutSession } from "@/api/types";

/** The one IndexedDB-backed store the active-workout screen uses for its
 * offline draft values and its idempotent set-write queue. */
export const activeWorkoutStorage = createIndexedDbStorage("active-workout");

function sessionKey(accountId: string): string {
  return `session:${accountId}`;
}

function readSnapshot(value: string | null): WorkoutSession | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as WorkoutSession | null;
    return session?.status === "active" && typeof session.id === "string" &&
      Array.isArray(session.exercises) ? session : null;
  } catch {
    return null;
  }
}

export async function loadWorkoutSnapshot(accountId: string): Promise<WorkoutSession | null> {
  const session = readSnapshot(await activeWorkoutStorage.getItem(sessionKey(accountId)));
  return session?.owner_id === accountId ? session : null;
}

export async function saveWorkoutSnapshot(accountId: string, session: WorkoutSession): Promise<void> {
  if (session.owner_id !== accountId || session.status !== "active") return;
  await activeWorkoutStorage.updateItem(sessionKey(accountId), (stored) => {
    const current = readSnapshot(stored);
    const value = stored && current?.id === session.id && current.version > session.version
      ? stored
      : JSON.stringify(session);
    return { value, result: undefined };
  });
}

export async function clearWorkoutSnapshot(accountId: string): Promise<void> {
  await activeWorkoutStorage.removeItem(sessionKey(accountId));
}
