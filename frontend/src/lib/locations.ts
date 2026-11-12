import type { EquipmentTag, Location, LocationKind, PlateProfile } from "@/api/types";

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
  plate_profiles: PlateProfile[];
}

export interface PlateProfileDraft {
  name: string;
  bar: string;
  collars: string;
  plates: Array<{ weight: string; pairs: string }>;
}

/** Created empty; you tick what each place has. */
export const DEFAULT_LOCATIONS: LocationPayload[] = [
  { name: "Office", kind: "office", equipment: [], default_minutes: null, plate_profiles: [] },
  { name: "Gym", kind: "gym", equipment: [], default_minutes: null, plate_profiles: [] },
  { name: "Home", kind: "home", equipment: [], default_minutes: null, plate_profiles: [] },
];

/** The editable form of a location: minutes stay text while typing. */
export interface LocationDraft {
  name: string;
  kind: LocationKind;
  equipment: EquipmentTag[];
  minutes: string;
  plateProfiles: PlateProfileDraft[];
}

export function emptyDraft(): LocationDraft {
  return { name: "", kind: "home", equipment: [], minutes: "", plateProfiles: [] };
}

export function draftFromLocation(location: Location): LocationDraft {
  return {
    name: location.name,
    kind: location.kind,
    equipment: [...location.equipment],
    minutes: location.default_minutes === null ? "" : String(location.default_minutes),
    plateProfiles: (location.plate_profiles ?? []).map((profile) => ({
      name: profile.name,
      bar: String(profile.bar_kg),
      collars: String(profile.collars_kg),
      plates: profile.plates.map((plate) => ({
        weight: String(plate.weight_kg),
        pairs: String(plate.pairs),
      })),
    })),
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
  const plateProfiles: PlateProfile[] = [];
  const names = new Set<string>();
  for (const profile of draft.plateProfiles) {
    const name = profile.name.trim();
    if (!name || name.length > 60 || names.has(name.toLocaleLowerCase())) {
      return { ok: false, error: "Bar profile names must be unique and at most 60 characters." };
    }
    names.add(name.toLocaleLowerCase());
    const bar = Number(profile.bar);
    const collars = Number(profile.collars);
    if (!validLoad(bar, 0, 100) || !validLoad(collars, 0, 10) || bar === 0) {
      return { ok: false, error: "Bar and collar weights must use up to three decimals." };
    }
    const plates: PlateProfile["plates"] = [];
    const weights = new Set<number>();
    for (const plate of profile.plates) {
      const weight = Number(plate.weight);
      const pairs = Number(plate.pairs);
      if (!validLoad(weight, 0, 100) || weight === 0 ||
          !Number.isInteger(pairs) || pairs < 1 || pairs > 30 || weights.has(weight)) {
        return { ok: false, error: "Plate weights must be unique to three decimals with 1–30 pairs." };
      }
      weights.add(weight);
      plates.push({ weight_kg: weight, pairs });
    }
    if (!plates.length || plates.length > 20) {
      return { ok: false, error: "Add between 1 and 20 plate sizes to each bar profile." };
    }
    plates.sort((left, right) => right.weight_kg - left.weight_kg);
    plateProfiles.push({ name, bar_kg: bar, collars_kg: collars, plates });
  }
  if (plateProfiles.length > 8) {
    return { ok: false, error: "A location can have at most 8 bar profiles." };
  }
  return {
    ok: true,
    payload: {
      name,
      kind: draft.kind,
      equipment: [...new Set(draft.equipment)].sort(),
      default_minutes: minutes,
      plate_profiles: plateProfiles,
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
    || JSON.stringify(payload.plate_profiles) !== JSON.stringify(saved.plate_profiles ?? [])
  );
}

function validLoad(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum &&
    Math.abs(value * 1000 - Math.round(value * 1000)) < 0.000001;
}

const TRAINING_LOCATION_KEY = "workout_logger_training_location";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The location last picked for starting workouts, if it still exists; "" means anywhere. */
export function readTrainingLocation(storage: KeyValueStorage, knownIds: string[]): string {
  try {
    const id = storage.getItem(TRAINING_LOCATION_KEY) ?? "";
    return knownIds.includes(id) ? id : "";
  } catch {
    return "";
  }
}

export function writeTrainingLocation(storage: KeyValueStorage, id: string): void {
  try {
    if (id) storage.setItem(TRAINING_LOCATION_KEY, id);
    else storage.removeItem(TRAINING_LOCATION_KEY);
  } catch {
    // A blocked storage only costs the remembered choice.
  }
}
