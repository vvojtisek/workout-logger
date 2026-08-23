import { createIndexedDbStorage } from "./indexeddb-storage";

/** The one IndexedDB-backed store the active-workout screen uses for its
 * offline draft values and its idempotent set-write queue. */
export const activeWorkoutStorage = createIndexedDbStorage("active-workout");
