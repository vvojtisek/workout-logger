import { useSyncExternalStore } from "react";

/** What the person picked in Settings. `system` follows the device. */
export type ThemePreference = "dark" | "light" | "system";
/** What the document actually renders. */
export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "workout_logger_theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";
export const THEME_PREFERENCES: { value: ThemePreference; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === "dark" || raw === "light" || raw === "system" ? raw : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ThemeMedia {
  matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
}

interface ThemeRoot {
  dataset: DOMStringMap;
  style: { colorScheme: string };
}

export interface ThemeController {
  start(): void;
  getPreference(): ThemePreference;
  getTheme(): Theme;
  setPreference(next: ThemePreference): void;
  subscribe(listener: () => void): () => void;
}

/** Owns the theme for one document: reads and writes the stored choice, sets
 * `data-theme` (which tokens.css keys every colour on) and follows the device
 * while the choice is `system`. Storage may be blocked in private windows, so
 * every read and write tolerates failure and the app still renders. */
export function createThemeController({
  storage,
  root,
  media,
}: {
  storage: ThemeStorage | null;
  root: ThemeRoot;
  media: ThemeMedia | null;
}): ThemeController {
  let preference: ThemePreference = DEFAULT_THEME_PREFERENCE;
  const listeners = new Set<() => void>();

  const current = (): Theme => resolveTheme(preference, media?.matches ?? true);
  const apply = () => {
    const theme = current();
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    start() {
      try {
        preference = parseThemePreference(storage?.getItem(THEME_STORAGE_KEY));
      } catch {
        preference = DEFAULT_THEME_PREFERENCE;
      }
      apply();
      media?.addEventListener("change", () => {
        if (preference !== "system") return;
        apply();
        notify();
      });
    },
    getPreference: () => preference,
    getTheme: current,
    setPreference(next) {
      preference = next;
      try {
        storage?.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // The choice still applies for this visit.
      }
      apply();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function browserStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let browserController: ThemeController | null = null;

/** The one controller for this page; started from main.tsx before first render. */
export function themeController(): ThemeController {
  if (!browserController) {
    browserController = createThemeController({
      storage: browserStorage(),
      root: document.documentElement,
      media: typeof window.matchMedia === "function" ? window.matchMedia(SYSTEM_DARK_QUERY) : null,
    });
  }
  return browserController;
}

/** The theme on screen right now, for controls that flip between the two. */
export function useTheme(): Theme {
  const controller = themeController();
  return useSyncExternalStore(controller.subscribe, controller.getTheme);
}

export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const controller = themeController();
  const preference = useSyncExternalStore(controller.subscribe, controller.getPreference);
  return [preference, controller.setPreference];
}
