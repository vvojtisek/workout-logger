import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch, ApiError, errorMessage } from "@/api/client";
import type { EquipmentTag, Location, LocationKind, Paginated } from "@/api/types";
import { LOCATION_KINDS } from "@/api/types";
import {
  DEFAULT_LOCATIONS,
  LOCATION_KIND_LABELS,
  type LocationDraft,
  type DumbbellProfileDraft,
  type PlateProfileDraft,
  draftFromLocation,
  draftIsDirty,
  draftToPayload,
  emptyDraft,
} from "@/lib/locations";
import { Button, Card, EmptyState, Input, PageHeading } from "@/ui";
import { ConfirmDialog } from "@/ui/Dialog";
import { EquipmentChips } from "@/ui/EquipmentChips";
import { toast } from "@/ui/Toast";

const LOCATIONS_KEY = ["locations"];

function toggle(list: EquipmentTag[], tag: EquipmentTag): EquipmentTag[] {
  return list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag];
}

function newPlateProfile(): PlateProfileDraft {
  return {
    name: "Olympic bar",
    bar: "20",
    collars: "0",
    plates: [25, 20, 15, 10, 5, 2.5, 1.25].map((weight) => ({
      weight: String(weight),
      pairs: weight === 20 ? "2" : "1",
    })),
  };
}

function newDumbbellProfile(): DumbbellProfileDraft {
  return {
    name: "Adjustable dumbbell",
    handle: "2.5",
    collars: "0",
    plates: [5, 2.5, 1.25, 0.5].map((weight) => ({ weight: String(weight), pairs: "1" })),
  };
}

function saveError(err: unknown): string {
  if (err instanceof ApiError && err.code === "LOCATION_NAME_CONFLICT") return err.message;
  return `Failed to save location: ${errorMessage(err)}`;
}

function LocationFields({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string;
  draft: LocationDraft;
  onChange: (draft: LocationDraft) => void;
}) {
  function updateProfile(index: number, next: PlateProfileDraft) {
    onChange({
      ...draft,
      plateProfiles: draft.plateProfiles.map((profile, current) => current === index ? next : profile),
    });
  }

  function updateDumbbellProfile(index: number, next: DumbbellProfileDraft) {
    onChange({
      ...draft,
      dumbbellProfiles: draft.dumbbellProfiles.map((profile, current) => current === index ? next : profile),
    });
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_10rem]">
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-name`}>
            Name
          </label>
          <Input
            id={`${idPrefix}-name`}
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-kind`}>
            Kind
          </label>
          <select
            id={`${idPrefix}-kind`}
            className="input"
            value={draft.kind}
            onChange={(event) => onChange({ ...draft, kind: event.target.value as LocationKind })}
          >
            {LOCATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {LOCATION_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor={`${idPrefix}-minutes`}>
            Session minutes
          </label>
          <Input
            id={`${idPrefix}-minutes`}
            inputMode="numeric"
            placeholder="e.g. 30"
            value={draft.minutes}
            onChange={(event) => onChange({ ...draft, minutes: event.target.value })}
          />
        </div>
      </div>
      <div>
        <span className="field-label">Equipment here</span>
        <EquipmentChips
          label={`${draft.name.trim() || "New location"} equipment`}
          selected={draft.equipment}
          hideBodyweight
          onToggle={(tag) => onChange({ ...draft, equipment: toggle(draft.equipment, tag) })}
        />
      </div>
      <section aria-label="Barbell equipment" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Barbell profiles</h3>
            <p className="text-sm text-muted">Bar weight, collars, and paired plates available here.</p>
          </div>
          <Button
            variant="secondary"
            disabled={draft.plateProfiles.length >= 8}
            onClick={() => onChange({ ...draft, plateProfiles: [...draft.plateProfiles, newPlateProfile()] })}
          >
            Add bar profile
          </Button>
        </div>
        {draft.plateProfiles.map((profile, index) => (
          <fieldset key={index} className="grid gap-3 rounded-[var(--radius-md)] border border-line p-3">
            <legend className="px-1 text-sm font-medium">Profile {index + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="field-label">
                Name
                <Input aria-label={`Bar profile ${index + 1} name`} value={profile.name}
                  onChange={(event) => updateProfile(index, { ...profile, name: event.target.value })} />
              </label>
              <label className="field-label">
                Bar weight (kg)
                <Input aria-label={`Bar profile ${index + 1} bar weight (kg)`} type="number" min="0.001" max="100" step="0.001" inputMode="decimal" value={profile.bar}
                  onChange={(event) => updateProfile(index, { ...profile, bar: event.target.value })} />
              </label>
              <label className="field-label">
                Collars (kg)
                <Input aria-label={`Bar profile ${index + 1} collars (kg)`} type="number" min="0" max="10" step="0.001" inputMode="decimal" value={profile.collars}
                  onChange={(event) => updateProfile(index, { ...profile, collars: event.target.value })} />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              {profile.plates.map((plate, plateIndex) => (
                <div key={plateIndex} className="grid grid-cols-2 gap-2">
                  <label className="field-label">
                    Plate (kg)
                    <Input aria-label={`Bar profile ${index + 1} plate ${plateIndex + 1} weight (kg)`} type="number" min="0.001" max="100" step="0.001" inputMode="decimal" value={plate.weight}
                      onChange={(event) => updateProfile(index, { ...profile, plates: profile.plates.map((item, current) => current === plateIndex ? { ...item, weight: event.target.value } : item) })} />
                  </label>
                  <label className="field-label">
                    Pairs
                    <Input aria-label={`Bar profile ${index + 1} plate ${plateIndex + 1} pairs`} type="number" min="1" max="30" step="1" inputMode="numeric" value={plate.pairs}
                      onChange={(event) => updateProfile(index, { ...profile, plates: profile.plates.map((item, current) => current === plateIndex ? { ...item, pairs: event.target.value } : item) })} />
                  </label>
                </div>
              ))}
              <div className="flex flex-wrap items-end gap-2">
                <Button variant="secondary" disabled={profile.plates.length >= 20}
                  onClick={() => updateProfile(index, { ...profile, plates: [...profile.plates, { weight: "2.5", pairs: "1" }] })}>
                  Add plate size
                </Button>
                <Button variant="ghost" disabled={profile.plates.length <= 1}
                  onClick={() => updateProfile(index, { ...profile, plates: profile.plates.slice(0, -1) })}>
                  Remove last size
                </Button>
              </div>
            </div>
            <Button variant="ghost" className="self-start" onClick={() => onChange({ ...draft, plateProfiles: draft.plateProfiles.filter((_, current) => current !== index) })}>
              Remove profile
            </Button>
          </fieldset>
        ))}
      </section>
      <section aria-label="Adjustable dumbbells" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Adjustable dumbbells</h3>
            <p className="text-sm text-muted">Handle mass and symmetric plate pairs for each dumbbell.</p>
          </div>
          <Button
            variant="secondary"
            disabled={draft.dumbbellProfiles.length >= 8}
            onClick={() => onChange({ ...draft, dumbbellProfiles: [...draft.dumbbellProfiles, newDumbbellProfile()] })}
          >
            Add dumbbell profile
          </Button>
        </div>
        {draft.dumbbellProfiles.map((profile, index) => (
          <fieldset key={index} className="grid gap-3 rounded-[var(--radius-md)] border border-line p-3">
            <legend className="px-1 text-sm font-medium">Dumbbell profile {index + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="field-label">
                Name
                <Input aria-label={`Dumbbell profile ${index + 1} name`} value={profile.name}
                  onChange={(event) => updateDumbbellProfile(index, { ...profile, name: event.target.value })} />
              </label>
              <label className="field-label">
                Handle weight (kg)
                <Input aria-label={`Dumbbell profile ${index + 1} handle weight (kg)`} type="number" min="0.001" max="30" step="0.001" inputMode="decimal" value={profile.handle}
                  onChange={(event) => updateDumbbellProfile(index, { ...profile, handle: event.target.value })} />
              </label>
              <label className="field-label">
                Collars (kg)
                <Input aria-label={`Dumbbell profile ${index + 1} collars (kg)`} type="number" min="0" max="10" step="0.001" inputMode="decimal" value={profile.collars}
                  onChange={(event) => updateDumbbellProfile(index, { ...profile, collars: event.target.value })} />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              {profile.plates.map((plate, plateIndex) => (
                <div key={plateIndex} className="grid grid-cols-2 gap-2">
                  <label className="field-label">
                    Plate (kg)
                    <Input aria-label={`Dumbbell profile ${index + 1} plate ${plateIndex + 1} weight (kg)`} type="number" min="0.001" max="100" step="0.001" inputMode="decimal" value={plate.weight}
                      onChange={(event) => updateDumbbellProfile(index, { ...profile, plates: profile.plates.map((item, current) => current === plateIndex ? { ...item, weight: event.target.value } : item) })} />
                  </label>
                  <label className="field-label">
                    Pairs
                    <Input aria-label={`Dumbbell profile ${index + 1} plate ${plateIndex + 1} pairs`} type="number" min="1" max="30" step="1" inputMode="numeric" value={plate.pairs}
                      onChange={(event) => updateDumbbellProfile(index, { ...profile, plates: profile.plates.map((item, current) => current === plateIndex ? { ...item, pairs: event.target.value } : item) })} />
                  </label>
                </div>
              ))}
              <div className="flex flex-wrap items-end gap-2">
                <Button variant="secondary" disabled={profile.plates.length >= 20}
                  onClick={() => updateDumbbellProfile(index, { ...profile, plates: [...profile.plates, { weight: "2.5", pairs: "1" }] })}>
                  Add plate size
                </Button>
                <Button variant="ghost" disabled={profile.plates.length <= 1}
                  onClick={() => updateDumbbellProfile(index, { ...profile, plates: profile.plates.slice(0, -1) })}>
                  Remove last size
                </Button>
              </div>
            </div>
            <Button variant="ghost" className="self-start" onClick={() => onChange({ ...draft, dumbbellProfiles: draft.dumbbellProfiles.filter((_, current) => current !== index) })}>
              Remove dumbbell profile
            </Button>
          </fieldset>
        ))}
      </section>
    </>
  );
}

function LocationCard({ location, onDelete }: { location: Location; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => draftFromLocation(location));
  const [error, setError] = useState<string | null>(null);
  const dirty = draftIsDirty(draft, location);

  const save = useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch<Location>(`/locations/${location.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (saved) => {
      setDraft(draftFromLocation(saved));
      setError(null);
      toast.success(`Saved "${saved.name}"`);
      void queryClient.invalidateQueries({ queryKey: LOCATIONS_KEY });
    },
    onError: (err: unknown) => setError(saveError(err)),
  });

  function submit() {
    const result = draftToPayload(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    save.mutate(result.payload);
  }

  return (
    <li>
      <Card className="flex flex-col gap-4 p-4">
        <LocationFields idPrefix={`location-${location.id}`} draft={draft} onChange={setDraft} />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!dirty || save.isPending}
            onClick={submit}
            aria-label={`Save ${location.name}`}
          >
            Save
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setDraft(draftFromLocation(location))}>
              Undo changes
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onDelete} aria-label={`Delete ${location.name}`}>
            Delete
          </Button>
        </div>
      </Card>
    </li>
  );
}

function NewLocationCard() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<LocationDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch<Location>("/locations", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (created) => {
      setDraft(emptyDraft());
      setError(null);
      toast.success(`Added "${created.name}"`);
      void queryClient.invalidateQueries({ queryKey: LOCATIONS_KEY });
    },
    onError: (err: unknown) => setError(saveError(err)),
  });

  function submit() {
    const result = draftToPayload(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    create.mutate(result.payload);
  }

  return (
    <Card className="mt-4 flex flex-col gap-4 p-4">
      <h3 className="font-medium">Add a location</h3>
      <LocationFields idPrefix="new-location" draft={draft} onChange={setDraft} />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div>
        <Button variant="primary" disabled={create.isPending} onClick={submit}>
          Add location
        </Button>
      </div>
    </Card>
  );
}

export function LocationsView() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: LOCATIONS_KEY,
    queryFn: () => apiFetch<Paginated<Location>>("/locations?limit=100"),
  });

  const addDefaults = useMutation({
    mutationFn: async () => {
      for (const location of DEFAULT_LOCATIONS) {
        await apiFetch<Location>("/locations", {
          method: "POST",
          body: JSON.stringify(location),
        });
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: LOCATIONS_KEY }),
    onError: (err: unknown) => toast.error(saveError(err)),
  });

  const remove = useMutation({
    mutationFn: (location: Location) =>
      apiFetch(`/locations/${location.id}`, { method: "DELETE" }),
    onSuccess: (_, location) => {
      toast.success(`Deleted "${location.name}"`);
      void queryClient.invalidateQueries({ queryKey: LOCATIONS_KEY });
    },
    onError: (err: unknown) => toast.error(`Failed to delete location: ${errorMessage(err)}`),
  });

  const locations = data?.items ?? [];

  return (
    <section id="locations-view">
      <PageHeading hint="Where you train and what each place has. Bodyweight exercises work everywhere.">
        Locations
      </PageHeading>

      {isLoading ? <p className="text-sm text-muted">Loading locations…</p> : null}
      {error ? (
        <p className="text-sm text-danger">Failed to load locations: {errorMessage(error)}</p>
      ) : null}

      {!isLoading && !error && locations.length === 0 ? (
        <div className="flex flex-col gap-3">
          <EmptyState
            title="No locations yet"
            description="Start with Office, Gym and Home, then tick what each one has."
          />
          <div>
            <Button
              variant="primary"
              disabled={addDefaults.isPending}
              onClick={() => addDefaults.mutate()}
            >
              Add Office, Gym and Home
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="flex flex-col gap-4" aria-label="Locations">
        {locations.map((location) => (
          // Keyed by the saved version so a save elsewhere resets this form.
          <LocationCard
            key={`${location.id}:${location.updated_at}`}
            location={location}
            onDelete={() => setDeleteTarget(location)}
          />
        ))}
      </ul>

      {!isLoading && !error ? <NewLocationCard /> : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
        }}
        title="Delete location"
        message={`Delete "${deleteTarget?.name}"? Logged workouts are not affected.`}
        confirmLabel="Delete"
      />
    </section>
  );
}
