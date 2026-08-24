import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiFetch, apiFetchBlob, errorMessage, triggerBlobDownload } from "@/api/client";
import type { McpStatus, UserSettings, Units } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { SETTINGS_QUERY_KEY, useSettingsQuery } from "@/lib/settings-query";
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
          <span className="ml-2 rounded-full bg-surface-raised px-2.5 py-0.5 text-xs font-medium text-muted">
            {user.role}
          </span>
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
    onError: (err: unknown) => toast.error(`Failed to save: ${errorMessage(err)}`),
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
              Pre-fills the rest field when you add a compound or isolation exercise to a plan.
              Existing exercises are unaffected.
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
    2
  );

  return (
    <div className="mb-6">
      <SectionHeading>MCP Server</SectionHeading>
      <Card className="flex flex-col gap-3 p-4">
        {isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        {error ? (
          <p className="text-sm text-danger">Failed to load status: {errorMessage(error)}</p>
        ) : null}
        {data ? (
          <>
            <p className="text-sm">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  data.enabled ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                }`}
              >
                {data.enabled ? "enabled" : "disabled"}
              </span>
              <span className="ml-2 text-muted">
                {data.tool_count} tool{data.tool_count === 1 ? "" : "s"} at {data.path}
              </span>
            </p>
            <pre className="overflow-x-auto rounded-md bg-surface-raised p-3 text-xs">
              {configSnippet}
            </pre>
            <p className="text-sm text-muted">
              Mint the agent a scoped token under API Tokens with the read and log scopes, and
              swap it in for the placeholder above.
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
      triggerBlobDownload(blob, filename || `workout-logger-export.${format === "csv" ? "zip" : "json"}`);
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
          Every logged domain — plans, exercises, programs, scheduled workouts, sessions, body
          metrics, foods, nutrition plans, meal entries, sleep entries, step counts — as one
          download.
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
      <PreferencesSection />
      <McpSection />
      <ExportSection />
    </section>
  );
}
