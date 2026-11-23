import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  apiFetch,
  apiFetchBlob,
  errorMessage,
  triggerBlobDownload,
} from "@/api/client";
import { MAX_PRINCIPLES_LENGTH } from "@/api/types";
import type {
  AuditActorKind,
  AuditEventsPage,
  CoachingContextNotes,
  CoachingPrinciples,
  EquipmentProfile,
  McpStatus,
  PairingWindowResponse,
  UserSettings,
} from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import {
  ACTOR_KIND_LABELS,
  describeAction,
  describeActor,
  describeParams,
} from "@/lib/audit-events";
import { formatDateTime } from "@/lib/format";
import {
  readRestAlertPreferences,
  unlockRestAlertAudio,
  writeRestAlertPreferences,
} from "@/lib/rest-alerts";
import type { RestAlertPreferences } from "@/lib/rest-alerts";
import { SETTINGS_QUERY_KEY, useSettingsQuery } from "@/lib/settings-query";
import { THEME_PREFERENCES, useThemePreference } from "@/lib/theme";
import { Block, Button, Card, Input, PageHeading, EntryForm } from "@/ui";
import { AthleteProfileSection } from "./AthleteProfileSection";
import { toast } from "@/ui/Toast";

import {
  COACHING_NOTES_MAX_BYTES,
  formatByteUsage,
  formatClientTimestamp,
  formatPairingCountdown,
  remainingPairingSeconds,
  utf8ByteLength,
} from "./settings-helpers";

function SectionHeading({ children }: { children: string }) {
  return <h2 className="mb-2 text-sm font-medium text-muted">{children}</h2>;
}

function AccountSection() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="mb-6">
      <SectionHeading>Account</SectionHeading>
      <Block className="py-4">
        <p className="text-sm">
          Logged in as <span className="font-medium">{user.email}</span>
          <span className="ml-2 rounded-full bg-elevated px-2.5 py-0.5 text-xs font-medium text-muted">
            {user.role}
          </span>
        </p>
      </Block>
    </div>
  );
}

/** Stored on this device only: a phone in a dark gym and a desktop by a window
 * can each keep their own choice. */
function AppearanceSection() {
  const [preference, setPreference] = useThemePreference();
  return (
    <div className="mb-6">
      <SectionHeading>Appearance</SectionHeading>
      <Block className="flex flex-col gap-2 py-4">
        <p className="field-label" id="theme-label">
          Theme
        </p>
        <div
          id="theme-control"
          role="radiogroup"
          aria-labelledby="theme-label"
          className="inline-flex w-fit rounded-[var(--radius-md)] border border-line bg-subtle p-1"
        >
          {THEME_PREFERENCES.map((option) => {
            const selected = option.value === preference;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPreference(option.value)}
                className={`min-h-11 min-w-20 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium transition-colors ${
                  selected
                    ? "bg-elevated text-main shadow-sm"
                    : "text-muted hover:text-main"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-muted">
          System follows your device. Saved on this device only.
        </p>
      </Block>
    </div>
  );
}

function WorkoutAlertsSection() {
  const [preferences, setPreferences] = useState(readRestAlertPreferences);

  function toggle(key: keyof RestAlertPreferences) {
    const next = { ...preferences, [key]: !preferences[key] };
    writeRestAlertPreferences(next);
    setPreferences(next);
    if (key === "sound" && next.sound) unlockRestAlertAudio();
  }

  return (
    <div className="mb-6">
      <SectionHeading>Workout alerts</SectionHeading>
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">
          Rest completion cues are stored on this device. Sound unlocks when you complete a set;
          vibration depends on browser and device support.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            id="rest-alert-sound"
            aria-pressed={preferences.sound}
            onClick={() => toggle("sound")}
          >
            Rest sound: {preferences.sound ? "On" : "Off"}
          </Button>
          <Button
            id="rest-alert-vibration"
            aria-pressed={preferences.vibration}
            onClick={() => toggle("vibration")}
          >
            Rest vibration: {preferences.vibration ? "On" : "Off"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function PreferencesSection() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useSettingsQuery();
  const [compound, setCompound] = useState("90");
  const [isolation, setIsolation] = useState("60");
  const [equipmentProfiles, setEquipmentProfiles] = useState<EquipmentProfile[]>([]);
  const [activeEquipmentProfileId, setActiveEquipmentProfileId] = useState("barbell-default");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!settings || seeded) return;
    setCompound(String(settings.default_rest_compound_seconds));
    setIsolation(String(settings.default_rest_isolation_seconds));
    setEquipmentProfiles(settings.equipment_profiles);
    setActiveEquipmentProfileId(settings.active_equipment_profile_id);
    setSeeded(true);
  }, [settings, seeded]);

  const activeProfile = equipmentProfiles.find(
    (profile) => profile.id === activeEquipmentProfileId,
  ) ?? equipmentProfiles[0];

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<UserSettings>("/settings", {
        method: "PUT",
        body: JSON.stringify({
          units: "metric",
          default_rest_compound_seconds: Number.parseInt(compound, 10),
          default_rest_isolation_seconds: Number.parseInt(isolation, 10),
          barbell_weight_kg: activeProfile?.barbell_weight_kg,
          plate_inventory: activeProfile?.plate_inventory,
          equipment_profiles: equipmentProfiles,
          active_equipment_profile_id: activeEquipmentProfileId,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      toast.success("Preferences saved");
    },
    onError: (err: unknown) =>
      toast.error(`Failed to save: ${errorMessage(err)}`),
  });

  return (
    <div className="mb-6">
      <SectionHeading>Preferences</SectionHeading>
      <EntryForm onSave={() => mutation.mutate()} className="block-flat flex flex-col gap-4 py-4">
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <div>
              <p className="field-label">Units</p>
              <p className="text-sm">Metric (kg, cm)</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="rest-compound">
                  Default rest — compound (s)
                </label>
                <Input
                  id="rest-compound"
                  type="number"
                  min="0"
                  max="3600"
                  value={compound}
                  onChange={(e) => setCompound(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="rest-isolation">
                  Default rest — isolation (s)
                </label>
                <Input
                  id="rest-isolation"
                  type="number"
                  min="0"
                  max="3600"
                  value={isolation}
                  onChange={(e) => setIsolation(e.target.value)}
                />
              </div>
            </div>
            <p className="text-sm text-muted">
              Pre-fills the rest field when you add a compound or isolation
              exercise to a plan. Existing exercises are unaffected.
            </p>
            <div>
              <label className="field-label" htmlFor="active-equipment-profile">
                Active equipment profile
              </label>
              <select
                id="active-equipment-profile"
                className="input"
                value={activeEquipmentProfileId}
                onChange={(event) => setActiveEquipmentProfileId(event.target.value)}
              >
                {equipmentProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-3">
              {equipmentProfiles.map((profile, profileIndex) => (
                <fieldset key={profile.id} className="flex flex-col gap-3 rounded-lg border border-line-muted p-3">
                  <legend className="field-label px-1">Equipment profile {profileIndex + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-[1fr_minmax(10rem,14rem)]">
                    <div>
                      <label className="field-label" htmlFor={`equipment-profile-name-${profile.id}`}>
                        Profile name
                      </label>
                      <Input
                        id={`equipment-profile-name-${profile.id}`}
                        value={profile.name}
                        onChange={(event) => {
                          const next = [...equipmentProfiles];
                          next[profileIndex] = { ...profile, name: event.target.value };
                          setEquipmentProfiles(next);
                        }}
                      />
                    </div>
                    <div>
                      <label className="field-label" htmlFor={`equipment-profile-weight-${profile.id}`}>
                        Bar weight (kg)
                      </label>
                      <Input
                        id={`equipment-profile-weight-${profile.id}`}
                        type="number"
                        min="0.25"
                        max="100"
                        step="0.25"
                        value={profile.barbell_weight_kg}
                        onChange={(event) => {
                          const next = [...equipmentProfiles];
                          next[profileIndex] = {
                            ...profile,
                            barbell_weight_kg: Number.parseFloat(event.target.value) || 0,
                          };
                          setEquipmentProfiles(next);
                        }}
                      />
                    </div>
                  </div>
                  <fieldset className="min-w-0">
                    <legend className="field-label">Plate pairs available per side</legend>
                    <div className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-5">
                      {profile.plate_inventory.map((plate, index) => (
                        <label key={plate.plate_weight_kg} className="flex items-center gap-2 text-sm">
                          <span className="min-w-12">{plate.plate_weight_kg} kg</span>
                          <Input
                            aria-label={`${profile.name}: ${plate.plate_weight_kg} kg plate pairs`}
                            type="number"
                            min="0"
                            max="20"
                            step="1"
                            value={plate.pairs}
                            onChange={(event) => {
                              const inventory = [...profile.plate_inventory];
                              inventory[index] = {
                                ...plate,
                                pairs: Number.parseInt(event.target.value, 10) || 0,
                              };
                              const next = [...equipmentProfiles];
                              next[profileIndex] = { ...profile, plate_inventory: inventory };
                              setEquipmentProfiles(next);
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {equipmentProfiles.length > 1 ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const remaining = equipmentProfiles.filter((item) => item.id !== profile.id);
                        setEquipmentProfiles(remaining);
                        if (activeEquipmentProfileId === profile.id) {
                          setActiveEquipmentProfileId(remaining[0]?.id ?? "");
                        }
                      }}
                    >
                      Remove profile
                    </Button>
                  ) : null}
                </fieldset>
              ))}
              {equipmentProfiles.length < 12 ? (
                <Button
                  onClick={() => {
                    const first = equipmentProfiles[0];
                    const id = `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                    setEquipmentProfiles([
                      ...equipmentProfiles,
                      {
                        id,
                        name: "New bar",
                        barbell_weight_kg: 15,
                        plate_inventory: first ? [...first.plate_inventory] : [],
                      },
                    ]);
                  }}
                >
                  Add equipment profile
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted">
              Profiles are saved in your settings. The in-workout plate calculator can switch
              profiles for the current workout; a pair means one matching plate on each side.
            </p>
            <div>
              <Button
                id="save-preferences-btn"
                variant="primary"
                disabled={mutation.isPending}
                type="submit"
              >
                Save preferences
              </Button>
            </div>
          </>
        )}
      </EntryForm>
    </div>
  );
}

const PRINCIPLES_QUERY_KEY = ["coaching-principles"];

/** One text the admin owns. An assistant reads it over MCP when it designs a
 * training block; the app's own rules never read it. */
function CoachingPrinciplesSection() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const { data, error, isLoading } = useQuery({
    queryKey: PRINCIPLES_QUERY_KEY,
    queryFn: () => apiFetch<CoachingPrinciples>("/coaching-principles"),
  });
  const [body, setBody] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!data || seeded) return;
    setBody(data.body);
    setSeeded(true);
  }, [data, seeded]);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<CoachingPrinciples>("/coaching-principles", {
        method: "PUT",
        body: JSON.stringify({ body }),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(PRINCIPLES_QUERY_KEY, saved);
      toast.success("Coaching principles saved");
    },
    onError: (err: unknown) =>
      toast.error(`Failed to save: ${errorMessage(err)}`),
  });

  return (
    <div className="mb-6">
      <SectionHeading>Coaching principles</SectionHeading>
      <EntryForm onSave={() => mutation.mutate()} className="block-flat flex flex-col gap-3 py-4">
        <p className="text-sm text-muted">
          Your training beliefs and preferences, in your own words. An assistant
          connected over MCP reads them when it designs or reviews a training
          block. The app&apos;s own progression and hockey rules do not use
          them.
        </p>
        {isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        {error ? (
          <p className="text-sm text-danger">
            Failed to load: {errorMessage(error)}
          </p>
        ) : null}
        {data && canEdit ? (
          <>
            <label className="field-label" htmlFor="coaching-principles">
              Principles
            </label>
            <textarea
              id="coaching-principles"
              className="input font-mono text-sm"
              rows={10}
              maxLength={MAX_PRINCIPLES_LENGTH}
              placeholder={
                "For example:\n- Evidence-based methods only, no fads.\n- Health and family come before training."
              }
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <p className="text-xs text-muted">
              {body.length.toLocaleString()} of{" "}
              {MAX_PRINCIPLES_LENGTH.toLocaleString()} characters
              {data.updated_at
                ? ` · last saved ${formatDateTime(data.updated_at)}`
                : ""}
            </p>
            <div>
              <Button
                id="save-principles-btn"
                variant="primary"
                disabled={mutation.isPending || body === data.body}
                type="submit"
              >
                Save principles
              </Button>
            </div>
          </>
        ) : null}
        {data && !canEdit ? (
          data.body ? (
            <p
              className="whitespace-pre-wrap text-sm"
              data-testid="coaching-principles-text"
            >
              {data.body}
            </p>
          ) : (
            <p className="text-sm text-muted">
              No principles written yet. Only an admin can edit them.
            </p>
          )
        ) : null}
      </EntryForm>
    </div>
  );
}

function McpSection() {
  const queryClient = useQueryClient();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["mcp-status"],
    queryFn: () => apiFetch<McpStatus>("/mcp-status"),
    refetchInterval: (query) => {
      const expires = query.state.data?.pairing_window_expires_at ?? null;
      return remainingPairingSeconds(expires) > 0 ? 5_000 : false;
    },
  });

  const pairingActive =
    remainingPairingSeconds(data?.pairing_window_expires_at ?? null, nowMs) > 0;
  const countdown = formatPairingCountdown(
    data?.pairing_window_expires_at ?? null,
    nowMs,
  );

  useEffect(() => {
    if (!data?.pairing_window_expires_at) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [data?.pairing_window_expires_at]);

  const openPairingMutation = useMutation({
    mutationFn: () =>
      apiFetch<PairingWindowResponse>("/mcp-status/pairing-window", {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-status"] });
      toast.success("Pairing window opened for 10 minutes");
    },
    onError: (err: unknown) =>
      toast.error(`Could not open pairing window: ${errorMessage(err)}`),
  });

  const closePairingMutation = useMutation({
    mutationFn: () =>
      apiFetch<PairingWindowResponse>("/mcp-status/pairing-window", {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-status"] });
      toast.success("Pairing window closed");
    },
    onError: (err: unknown) =>
      toast.error(`Could not close pairing window: ${errorMessage(err)}`),
  });

  const revokeClientMutation = useMutation({
    mutationFn: (clientId: string) =>
      apiFetch<void>(`/mcp-status/clients/${encodeURIComponent(clientId)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setConfirmRevokeId(null);
      void queryClient.invalidateQueries({ queryKey: ["mcp-status"] });
      toast.success("MCP client revoked");
    },
    onError: (err: unknown) =>
      toast.error(`Could not revoke client: ${errorMessage(err)}`),
  });

  const mcpUrl = `${window.location.origin}/mcp/`;

  return (
    <div className="mb-6">
      <SectionHeading>MCP Server</SectionHeading>
      <Block className="flex flex-col gap-3 py-4">
        {isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        {error ? (
          <p className="text-sm text-danger">
            Failed to load status: {errorMessage(error)}
          </p>
        ) : null}
        {data ? (
          <>
            <p className="text-sm">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  data.enabled
                    ? "bg-success-soft text-success"
                    : "bg-danger-soft text-danger"
                }`}
              >
                {data.enabled ? "enabled" : "disabled"}
              </span>
              <span className="ml-2 text-muted">
                {data.tool_count} tool{data.tool_count === 1 ? "" : "s"} at{" "}
                {data.path}
              </span>
            </p>
            <pre className="overflow-x-auto rounded-md bg-elevated p-3 text-xs">
              {mcpUrl}
            </pre>
            <p className="text-sm text-muted">
              Add this URL as a custom connector or remote MCP server in your
              assistant (Claude, ChatGPT, Gemini CLI). It signs you in through
              OAuth and asks for the read and log permissions. API tokens do
              not work here.
            </p>
            {data.clients != null ? (
              <div className="flex flex-col gap-3 border-t border-line-muted pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Client Pairing Window</p>
                    <p className="text-xs text-muted">
                      Dynamic Client Registration stays closed (403) until you
                      open a 10-minute window.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {pairingActive && countdown ? (
                      <>
                        <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                          Open · {countdown}
                        </span>
                        <Button
                          type="button"
                          disabled={closePairingMutation.isPending}
                          onClick={() => closePairingMutation.mutate()}
                        >
                          Close window
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        disabled={
                          !data.enabled ||
                          !data.oauth_enabled ||
                          openPairingMutation.isPending
                        }
                        onClick={() => openPairingMutation.mutate()}
                      >
                        Open 10-min pairing window
                      </Button>
                    )}
                  </div>
                </div>
                {data.clients.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {data.clients.map((client) => {
                      const confirming = confirmRevokeId === client.client_id;
                      return (
                        <li
                          key={client.client_id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-elevated p-3 text-xs"
                        >
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">
                              {client.client_name || client.client_id}
                            </span>
                            <span className="text-muted">
                              Scopes: {client.scopes.join(", ")} · Last used:{" "}
                              {formatClientTimestamp(client.last_used_at)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {confirming ? (
                              <>
                                <Button
                                  type="button"
                                  variant="danger"
                                  disabled={revokeClientMutation.isPending}
                                  onClick={() =>
                                    revokeClientMutation.mutate(
                                      client.client_id,
                                    )
                                  }
                                >
                                  Confirm
                                </Button>
                                <Button
                                  type="button"
                                  onClick={() => setConfirmRevokeId(null)}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                onClick={() =>
                                  setConfirmRevokeId(client.client_id)
                                }
                              >
                                Revoke
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </Block>
    </div>
  );
}

function WorkingNotesSection() {
  const queryClient = useQueryClient();
  const [notesText, setNotesText] = useState("");
  const [syncedVersion, setSyncedVersion] = useState<number | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["coaching-context-notes"],
    queryFn: () => apiFetch<CoachingContextNotes>("/coaching-context"),
  });

  useEffect(() => {
    if (!data) return;
    if (syncedVersion !== data.notes_version) {
      setNotesText(data.working_notes_md ?? "");
      setSyncedVersion(data.notes_version);
    }
  }, [data, syncedVersion]);

  const notesBytes = utf8ByteLength(notesText);
  const overLimit = notesBytes > COACHING_NOTES_MAX_BYTES;

  const saveNotesMutation = useMutation({
    mutationFn: () =>
      apiFetch<CoachingContextNotes>("/coaching-context/notes", {
        method: "PUT",
        body: JSON.stringify({
          working_notes_md: notesText,
          expected_notes_version: data?.notes_version ?? 1,
        }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["coaching-context-notes"], updated);
      setNotesText(updated.working_notes_md ?? "");
      setSyncedVersion(updated.notes_version);
      toast.success("Working notes saved");
    },
    onError: (err: unknown) =>
      toast.error(`Failed to save notes: ${errorMessage(err)}`),
  });

  const revertNotesMutation = useMutation({
    mutationFn: () =>
      apiFetch<CoachingContextNotes>("/coaching-context/revert", {
        method: "POST",
        body: JSON.stringify({ target: "notes" }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["coaching-context-notes"], updated);
      setNotesText(updated.working_notes_md ?? "");
      setSyncedVersion(updated.notes_version);
      toast.success("Working notes reverted");
    },
    onError: (err: unknown) =>
      toast.error(`Failed to revert notes: ${errorMessage(err)}`),
  });

  return (
    <div className="mb-6">
      <SectionHeading>Working coaching notes</SectionHeading>
      <Block className="flex flex-col gap-3 py-4">
        <p className="text-sm text-muted">
          Short-lived coaching focus and weekly adjustments shared across AI
          assistants over MCP (`update_coaching_notes`). Keeps one previous
          revision for one-click revert.
        </p>
        {isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        {error ? (
          <p className="text-sm text-danger">
            Failed to load: {errorMessage(error)}
          </p>
        ) : null}
        {data ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="field-label mb-0" htmlFor="coaching-notes-input">
                Working notes
              </label>
              <span
                className={`text-xs ${overLimit ? "font-medium text-danger" : "text-muted"}`}
              >
                v{data.notes_version} ·{" "}
                {formatByteUsage(notesBytes, COACHING_NOTES_MAX_BYTES)}
              </span>
            </div>
            <textarea
              id="coaching-notes-input"
              className="input font-mono text-sm"
              rows={5}
              value={notesText}
              onChange={(event) => setNotesText(event.target.value)}
              placeholder="Current week focus, temporary deload adjustments, travel notes…"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                id="save-coaching-notes-btn"
                type="button"
                variant="primary"
                disabled={overLimit || saveNotesMutation.isPending}
                onClick={() => saveNotesMutation.mutate()}
              >
                Save notes
              </Button>
              <Button
                id="revert-coaching-notes-btn"
                type="button"
                disabled={
                  !data.has_previous_notes || revertNotesMutation.isPending
                }
                onClick={() => revertNotesMutation.mutate()}
              >
                Revert notes
              </Button>
            </div>
          </>
        ) : null}
      </Block>
    </div>
  );
}

/** Admin only: what happened in the last 72 hours and who caused it. */
function ActionLogSection() {
  const { user } = useAuth();
  const [kind, setKind] = useState<AuditActorKind | "">("");
  const isAdmin = user?.role === "admin";
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["audit-events", kind],
    queryFn: () =>
      apiFetch<AuditEventsPage>(
        `/audit-events?limit=100${kind ? `&actor_kind=${kind}` : ""}`,
      ),
    enabled: isAdmin,
  });
  if (!isAdmin) return null;

  return (
    <div className="mb-6">
      <SectionHeading>Action log</SectionHeading>
      <Block className="flex flex-col gap-3 py-4">
        <p className="text-sm text-muted">
          Every change made in the app or through the API, and every MCP tool
          call, from the last {data?.retention_hours ?? 72} hours. Weights,
          measurements, passwords and tokens are never stored here. For an MCP
          client, the name is what the client reported; the model behind it is
          not sent, so it is not shown.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="field-label" htmlFor="action-log-kind">
              Who
            </label>
            <select
              id="action-log-kind"
              className="input"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as AuditActorKind | "")
              }
            >
              <option value="">Everyone</option>
              {Object.entries(ACTOR_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Button
            id="action-log-refresh"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            Refresh
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-danger">
            Failed to load: {errorMessage(error)}
          </p>
        ) : null}
        {data && data.items.length === 0 ? (
          <p className="text-sm text-muted">Nothing in the last 72 hours.</p>
        ) : null}
        {data && data.items.length > 0 ? (
          <ul id="action-log" className="flex flex-col divide-y divide-line-muted">
            {data.items.map((event) => (
              <li key={event.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-muted">
                    {formatDateTime(event.occurred_at)}
                  </span>
                  <span className="font-medium">{describeAction(event)}</span>
                  <span
                    className={
                      event.outcome === "success"
                        ? "text-success"
                        : "text-danger"
                    }
                  >
                    {event.outcome === "success" ? "done" : "failed"}
                    {event.status_code ? ` (${event.status_code})` : ""}
                  </span>
                </div>
                <div>{describeActor(event)}</div>
                {event.target_id ? (
                  <div className="text-xs text-muted">
                    {event.target_type}: {event.target_id}
                  </div>
                ) : null}
                {Object.keys(event.params).length > 0 ? (
                  <div className="break-words text-xs text-muted">
                    {describeParams(event.params)}
                  </div>
                ) : null}
                {event.error ? (
                  <div className="text-xs text-danger">{event.error}</div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {data && data.total > data.items.length ? (
          <p className="text-xs text-muted">
            Showing the newest {data.items.length} of {data.total}.
          </p>
        ) : null}
      </Block>
    </div>
  );
}

function ExportSection() {
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);

  async function runExport(format: "json" | "csv") {
    setExporting(format);
    try {
      const { blob, filename } = await apiFetchBlob(`/export?format=${format}`);
      triggerBlobDownload(
        blob,
        filename ||
          `workout-logger-export.${format === "csv" ? "zip" : "json"}`,
      );
      toast.success("Export ready");
    } catch (err) {
      toast.error(`Export failed: ${errorMessage(err)}`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="mb-6">
      <SectionHeading>Export Data</SectionHeading>
      <Block className="flex flex-col gap-3 py-4">
        <p className="text-sm text-muted">
          Every logged domain — plans, exercises, programs, scheduled workouts,
          sessions, body metrics, foods, nutrition plans, meal entries, sleep
          entries, step counts — as one download.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            id="export-json-btn"
            disabled={exporting !== null}
            onClick={() => void runExport("json")}
          >
            Export as JSON
          </Button>
          <Button
            id="export-csv-btn"
            disabled={exporting !== null}
            onClick={() => void runExport("csv")}
          >
            Export as CSV
          </Button>
        </div>
      </Block>
    </div>
  );
}

export function SettingsView() {
  return (
    <section id="settings-view">
      <PageHeading>Settings</PageHeading>
      <AccountSection />
      <AppearanceSection />
      <WorkoutAlertsSection />
      <PreferencesSection />
      <CoachingPrinciplesSection />
      <WorkingNotesSection />
      <AthleteProfileSection />
      <McpSection />
      <ActionLogSection />
      <ExportSection />
    </section>
  );
}
