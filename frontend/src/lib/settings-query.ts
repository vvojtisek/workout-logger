import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/api/client";
import type { UserSettings } from "@/api/types";

export const SETTINGS_QUERY_KEY = ["settings"];

/** Shared across Settings, Biometrics (units), and the plan builder (rest
 * defaults) so all three read the one server-side row through one cache entry. */
export function useSettingsQuery() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => apiFetch<UserSettings>("/settings"),
  });
}
