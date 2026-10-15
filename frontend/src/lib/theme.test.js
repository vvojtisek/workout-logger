import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  createThemeController,
  parseThemePreference,
  resolveTheme,
} from "./theme";

/** @param {Record<string, string>} initial */
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    /** @param {string} key */
    getItem: (key) => values.get(key) ?? null,
    /** @param {string} key @param {string} value */
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    values,
  };
}

/** @param {boolean} matches */
function fakeMedia(matches) {
  /** @type {Set<() => void>} */
  const listeners = new Set();
  return {
    matches,
    /** @param {string} _type @param {() => void} listener */
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    /** @param {boolean} next */
    flip(next) {
      this.matches = next;
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

function fakeRoot() {
  /** @type {{ dataset: Record<string, string | undefined>, style: { colorScheme: string } }} */
  const root = { dataset: {}, style: { colorScheme: "" } };
  return root;
}

describe("parseThemePreference", () => {
  it("accepts the three known choices", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("falls back to dark for anything else", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("dark");
    expect(parseThemePreference(null)).toBe("dark");
    expect(parseThemePreference("sepia")).toBe("dark");
  });
});

describe("resolveTheme", () => {
  it("keeps an explicit choice whatever the device prefers", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("follows the device for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("createThemeController", () => {
  it("applies the stored preference to the document", () => {
    const root = fakeRoot();
    const controller = createThemeController({
      storage: memoryStorage({ [THEME_STORAGE_KEY]: "light" }),
      root,
      media: fakeMedia(true),
    });
    controller.start();
    expect(controller.getPreference()).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("starts dark when nothing is stored", () => {
    const root = fakeRoot();
    createThemeController({ storage: memoryStorage(), root, media: fakeMedia(false) }).start();
    expect(root.dataset.theme).toBe("dark");
  });

  it("persists a new choice, applies it and tells subscribers", () => {
    const storage = memoryStorage();
    const root = fakeRoot();
    const controller = createThemeController({ storage, root, media: fakeMedia(false) });
    controller.start();
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.setPreference("light");

    expect(storage.values.get(THEME_STORAGE_KEY)).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("tracks the device while on system and ignores it otherwise", () => {
    const root = fakeRoot();
    const media = fakeMedia(true);
    const controller = createThemeController({ storage: memoryStorage(), root, media });
    controller.start();

    controller.setPreference("system");
    expect(root.dataset.theme).toBe("dark");
    media.flip(false);
    expect(root.dataset.theme).toBe("light");

    controller.setPreference("dark");
    media.flip(false);
    expect(root.dataset.theme).toBe("dark");
  });

  it("still works when storage throws", () => {
    const root = fakeRoot();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const controller = createThemeController({ storage: broken, root, media: null });
    controller.start();
    expect(root.dataset.theme).toBe("dark");
    controller.setPreference("light");
    expect(root.dataset.theme).toBe("light");
  });
});
