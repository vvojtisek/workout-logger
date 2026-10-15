import { useCallback, useSyncExternalStore } from "react";

/** Breakpoint between the mobile shell and the desktop 3-pane workspace. */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/** Live result of a CSS media query; re-renders when it flips (window resize,
 * device rotation). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
  );
}

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
