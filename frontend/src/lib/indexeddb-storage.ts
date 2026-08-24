import type { AsyncStorageLike } from "./active-workout-state";

const DB_NAME = "workout-logger-offline";
const DB_VERSION = 1;

/** Every domain's offline store lives in this one object store, keyed by
 * its own string keys - there is one shared IndexedDB database, not one
 * per domain, so opening it stays cheap no matter how many domains adopt it. */
const STORE_NAME = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error as Error);
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error as Error);
  });
}

/** A generic per-domain async key-value store backed by IndexedDB. Any
 * feature that needs offline-durable writes can call this rather than
 * rolling its own localStorage handling - `namespace` scopes its keys so
 * different domains sharing the one database never collide. */
export function createIndexedDbStorage(namespace: string): AsyncStorageLike {
  const scopedKey = (key: string) => `${namespace}:${key}`;

  return {
    async getItem(key: string): Promise<string | null> {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, "readonly");
      const value = await requestToPromise(tx.objectStore(STORE_NAME).get(scopedKey(key)));
      return (value as string | undefined) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, "readwrite");
      await requestToPromise(tx.objectStore(STORE_NAME).put(value, scopedKey(key)));
    },
    async removeItem(key: string): Promise<void> {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, "readwrite");
      await requestToPromise(tx.objectStore(STORE_NAME).delete(scopedKey(key)));
    },
  };
}
