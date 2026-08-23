import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Paginated, SleepEntry, SleepTrends } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, Card, EmptyState, PageHeading } from "@/ui";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function TrendCard({ trends }: { trends: SleepTrends }) {
  if (!trends.latest) {
    return (
      <EmptyState
        title="No sleep logged yet"
        description="Log your first entry to start tracking sleep duration and quality trends."
      />
    );
  }
  return (
    <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
      <div>
        <p className="text-xs text-muted">Last night</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {formatDuration(trends.latest.time_in_bed_seconds)}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">7-day average</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {trends.average_sleep_seconds_7d != null
            ? formatDuration(trends.average_sleep_seconds_7d)
            : "—"}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">30-day average</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {trends.average_sleep_seconds_30d != null
            ? formatDuration(trends.average_sleep_seconds_30d)
            : "—"}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">Avg. quality (7d)</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {trends.average_quality_score_7d != null
            ? `${trends.average_quality_score_7d.toFixed(1)} / 5`
            : "—"}
        </p>
      </div>
    </Card>
  );
}

export function SleepView() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<SleepEntry[]>([]);
  const [trends, setTrends] = useState<SleepTrends | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SleepEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesData, trendsData] = await Promise.all([
        apiFetch<Paginated<SleepEntry>>("/sleep-entries?limit=100"),
        apiFetch<SleepTrends>("/sleep-entries/trends"),
      ]);
      setEntries(entriesData.items);
      setTrends(trendsData);
      setError(null);
    } catch (err) {
      setError(`Failed to load sleep entries: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteEntry(entry: SleepEntry) {
    try {
      await apiFetch(`/sleep-entries/${entry.id}`, { method: "DELETE" });
      toast.success("Deleted entry");
      void load();
    } catch (err) {
      toast.error(`Failed to delete: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="sleep-view">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageHeading hint="Track sleep duration and quality over time.">Sleep</PageHeading>
        <Button variant="primary" onClick={() => void navigate("/sleep/new")}>
          Log sleep
        </Button>
      </div>

      <div className="mb-5">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : trends ? (
          <TrendCard trends={trends} />
        ) : null}
      </div>

      <ul id="sleep-entries-list" className="flex flex-col gap-3">
        {!error && !loading && entries.length === 0 ? (
          <li>
            <EmptyState
              title="No sleep entries yet"
              description="Tap 'Log sleep' to record last night's sleep."
            />
          </li>
        ) : null}
        {entries.map((entry) => (
          <li key={entry.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium tabular-nums">
                {entry.sleep_date}
                <span className="ml-2 text-sm font-normal text-muted">
                  {formatDuration(entry.time_in_bed_seconds)} in bed
                </span>
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {new Date(entry.sleep_start).toLocaleString()} →{" "}
                {new Date(entry.sleep_end).toLocaleString()}
                {entry.quality_score != null ? ` · Quality ${entry.quality_score}/5` : ""}
              </p>
              {entry.notes ? <p className="mt-0.5 text-sm text-muted">{entry.notes}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void navigate(`/sleep/${entry.id}/edit`)}>Edit</Button>
              <Button variant="ghost" onClick={() => setDeleteTarget(entry)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteEntry(deleteTarget);
        }}
        title="Delete sleep entry"
        message="Are you sure you want to delete this sleep entry? This cannot be undone."
        confirmLabel="Delete"
      />
    </section>
  );
}
