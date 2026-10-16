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
  CoachingPrinciples,
  McpStatus,
  UserSettings,
  Units,
} from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { formatDateTime } from "@/lib/format";
import { SETTINGS_QUERY_KEY, useSettingsQuery } from "@/lib/settings-query";
import { THEME_PREFERENCES, useThemePreference } from "@/lib/theme";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

function SectionHeading({ children }: { children: string }) {
  return <h2 className="mb-2 text-sm font-medium text-muted">{children}</h2>;
}

function AccountSection() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="mb-6">
      <SectionHeading>Account</SectionHeading>
      <Card className="p-4">
        <p className="text-sm">
          Logged in as <span className="font-medium">{user.email}</span>
          <span className="ml-2 rounded-full bg-elevated px-2.5 py-0.5 text-xs font-medium text-muted">
            {user.role}
          </span>
        </p>
      </Card>
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
      <Card className="flex flex-col gap-2 p-4">
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
                className={`min-w-20 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium transition-colors ${
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
      </Card>
    </div>
  );
}

function PreferencesSection() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useSettingsQuery();
  const [units, setUnits] = useState<Units>("metric");
  const [compound, setCompound] = useState("90");
  const [isolation, setIsolation] = useState("60");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!settings || seeded) return;
    setUnits(settings.units);
    setCompound(String(settings.default_rest_compound_seconds));
    setIsolation(String(settings.default_rest_isolation_seconds));
    setSeeded(true);
  }, [settings, seeded]);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<UserSettings>("/settings", {
        method: "PUT",
        body: JSON.stringify({
          units,
          default_rest_compound_seconds: Number.parseInt(compound, 10),
          default_rest_isolation_seconds: Number.parseInt(isolation, 10),
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
      <Card className="flex flex-col gap-4 p-4">
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <div>
              <p className="field-label">Units</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="units"
                    checked={units === "metric"}
                    onChange={() => setUnits("metric")}
                  />
                  Metric (kg, cm)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="units"
                    checked={units === "imperial"}
                    onChange={() => setUnits("imperial")}
                  />
                  Imperial (lb, in)
                </label>
              </div>
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
              <Button
                id="save-preferences-btn"
                variant="primary"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                Save preferences
              </Button>
            </div>
          </>
        )}
      </Card>
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
      <Card className="flex flex-col gap-3 p-4">
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
                onClick={() => mutation.mutate()}
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
      </Card>
    </div>
  );
}

function McpSection() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["mcp-status"],
    queryFn: () => apiFetch<McpStatus>("/mcp-status"),
  });

  const apiKey = "wl_...";
  const mcpUrl = `${window.location.origin}/mcp/`;
  const configSnippet = JSON.stringify(
    {
      mcpServers: {
        "workout-logger": {
          type: "http",
          url: mcpUrl,
          headers: { "X-API-Key": apiKey },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="mb-6">
      <SectionHeading>MCP Server</SectionHeading>
      <Card className="flex flex-col gap-3 p-4">
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
              {configSnippet}
            </pre>
            <p className="text-sm text-muted">
              Mint the agent a scoped token under API Tokens with the read and
              log scopes, and swap it in for the placeholder above.
            </p>
          </>
        ) : null}
      </Card>
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
      <Card className="flex flex-col gap-3 p-4">
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
      </Card>
    </div>
  );
}

export function SettingsView() {
  return (
    <section id="settings-view">
      <PageHeading>Settings</PageHeading>
      <AccountSection />
      <AppearanceSection />
      <PreferencesSection />
      <CoachingPrinciplesSection />
      <McpSection />
      <ExportSection />
    </section>
  );
}
