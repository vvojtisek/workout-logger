import { describe, expect, it } from "vitest";

import {
  claimRestAlert,
  readRestAlertPreferences,
  writeRestAlertPreferences,
} from "./rest-alerts";

function memoryStorage() {
  /** @type {Map<string, string>} */
  const values = new Map();
  return {
    getItem: (/** @type {string} */ key) => values.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ value) => values.set(key, value),
    removeItem: (/** @type {string} */ key) => values.delete(key),
  };
}

describe("rest alert preferences", () => {
  it("defaults to sound and vibration, and persists independent choices", () => {
    const storage = memoryStorage();
    expect(readRestAlertPreferences(storage)).toEqual({ sound: true, vibration: true });
    writeRestAlertPreferences({ sound: false, vibration: true }, storage);
    expect(readRestAlertPreferences(storage)).toEqual({ sound: false, vibration: true });
  });

  it("claims an expired deadline once, including after a component remount", () => {
    const storage = memoryStorage();
    const deadline = `2030-01-01T00:00:${Math.floor(Math.random() * 60).toString().padStart(2, "0")}Z`;
    expect(claimRestAlert(deadline, storage)).toBe(true);
    expect(claimRestAlert(deadline, storage)).toBe(false);
  });

  it("does not crash when browser storage is blocked", () => {
    const storage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    const deadline = `2031-${Math.floor(Math.random() * 12) + 1}-01T00:00:00Z`;
    expect(readRestAlertPreferences(storage)).toEqual({ sound: true, vibration: true });
    expect(claimRestAlert(deadline, storage)).toBe(true);
    expect(claimRestAlert(deadline, storage)).toBe(false);
  });
});
