import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCATIONS,
  draftFromLocation,
  draftIsDirty,
  draftToPayload,
  emptyDraft,
} from "./locations";

describe("default locations", () => {
  it("offers Office, Gym and Home with nothing ticked", () => {
    expect(DEFAULT_LOCATIONS.map((location) => [location.name, location.kind])).toEqual([
      ["Office", "office"],
      ["Gym", "gym"],
      ["Home", "home"],
    ]);
    expect(DEFAULT_LOCATIONS.every((location) => location.equipment.length === 0)).toBe(true);
  });
});

describe("location drafts", () => {
  /** @type {import("../api/types").Location} */
  const saved = {
    id: "1",
    name: "Office",
    kind: "office",
    equipment: ["bench", "dumbbell"],
    default_minutes: 30,
    created_at: "",
    updated_at: "",
  };

  it("round-trips a saved location", () => {
    expect(draftToPayload(draftFromLocation(saved))).toEqual({
      ok: true,
      payload: { name: "Office", kind: "office", equipment: ["bench", "dumbbell"], default_minutes: 30 },
    });
  });

  it("is dirty only after a change, whatever the tag order", () => {
    const draft = draftFromLocation(saved);
    expect(draftIsDirty(draft, saved)).toBe(false);
    expect(draftIsDirty({ ...draft, equipment: ["dumbbell", "bench"] }, saved)).toBe(false);
    expect(draftIsDirty({ ...draft, minutes: "45" }, saved)).toBe(true);
    expect(draftIsDirty({ ...draft, name: "Work" }, saved)).toBe(true);
  });

  it("treats blank minutes as no default and trims the name", () => {
    const result = draftToPayload({ ...emptyDraft(), name: "  Hotel ", kind: "travel" });
    expect(result).toEqual({
      ok: true,
      payload: { name: "Hotel", kind: "travel", equipment: [], default_minutes: null },
    });
  });

  it("rejects a blank name and minutes out of range", () => {
    expect(draftToPayload({ ...emptyDraft(), name: " " })).toMatchObject({ ok: false });
    expect(draftToPayload({ ...emptyDraft(), name: "Gym", minutes: "4" })).toMatchObject({
      ok: false,
    });
    expect(draftToPayload({ ...emptyDraft(), name: "Gym", minutes: "abc" })).toMatchObject({
      ok: false,
    });
  });
});

describe("training location preference", () => {
  it("remembers the chosen location and forgets one that no longer exists", async () => {
    const { readTrainingLocation, writeTrainingLocation } = await import("./locations");
    /** @type {Map<string, string>} */
    const data = new Map();
    const storage = {
      getItem: (/** @type {string} */ key) => data.get(key) ?? null,
      setItem: (/** @type {string} */ key, /** @type {string} */ value) => void data.set(key, value),
      removeItem: (/** @type {string} */ key) => void data.delete(key),
    };
    expect(readTrainingLocation(storage, ["a", "b"])).toBe("");
    writeTrainingLocation(storage, "b");
    expect(readTrainingLocation(storage, ["a", "b"])).toBe("b");
    expect(readTrainingLocation(storage, ["a"])).toBe("");
    writeTrainingLocation(storage, "");
    expect(data.size).toBe(0);
  });

  it("survives storage that throws", async () => {
    const { readTrainingLocation, writeTrainingLocation } = await import("./locations");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readTrainingLocation(broken, ["a"])).toBe("");
    expect(() => writeTrainingLocation(broken, "a")).not.toThrow();
  });
});
