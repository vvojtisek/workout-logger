import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch, ApiError, errorMessage } from "@/api/client";
import type { EquipmentTag, Location, LocationKind, Paginated } from "@/api/types";
import { LOCATION_KINDS } from "@/api/types";
import {
  DEFAULT_LOCATIONS,
  LOCATION_KIND_LABELS,
  type LocationDraft,
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
