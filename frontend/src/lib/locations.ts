import type { EquipmentTag, Location, LocationKind } from "@/api/types";

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  home: "Home",
  office: "Office",
  gym: "Gym",
  travel: "Travel",
};

export interface LocationPayload {
  name: string;
  kind: LocationKind;
  equipment: EquipmentTag[];
  default_minutes: number | null;
}

/** Created empty; you tick what each place has. */
export const DEFAULT_LOCATIONS: LocationPayload[] = [
  { name: "Office", kind: "office", equipment: [], default_minutes: null },
  { name: "Gym", kind: "gym", equipment: [], default_minutes: null },
  { name: "Home", kind: "home", equipment: [], default_minutes: null },
];

/** The editable form of a location: minutes stay text while typing. */
export interface LocationDraft {
  name: string;
  kind: LocationKind;
  equipment: EquipmentTag[];
  minutes: string;
}

export function emptyDraft(): LocationDraft {
  return { name: "", kind: "home", equipment: [], minutes: "" };
}

export function draftFromLocation(location: Location): LocationDraft {
  return {
    name: location.name,
    kind: location.kind,
    equipment: [...location.equipment],
    minutes: location.default_minutes === null ? "" : String(location.default_minutes),
  };
}

/** Mirrors `app/schemas/locations.py`. */
export function draftToPayload(
  draft: LocationDraft,
): { ok: true; payload: LocationPayload } | { ok: false; error: string } {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > 100) return { ok: false, error: "Name is at most 100 characters." };
  let minutes: number | null = null;
  if (draft.minutes.trim()) {
    minutes = Number(draft.minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) {
      return { ok: false, error: "Session length is a whole number from 5 to 240 minutes." };
    }
  }
  return {
    ok: true,
    payload: {
      name,
      kind: draft.kind,
      equipment: [...new Set(draft.equipment)].sort(),
      default_minutes: minutes,
    },
  };
}

export function draftIsDirty(draft: LocationDraft, saved: Location): boolean {
  const result = draftToPayload(draft);
  if (!result.ok) return true;
  const { payload } = result;
  return (
    payload.name !== saved.name ||
    payload.kind !== saved.kind ||
    payload.default_minutes !== saved.default_minutes ||
    payload.equipment.join() !== [...saved.equipment].sort().join()
  );
}
