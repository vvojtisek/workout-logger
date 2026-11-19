import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useSleepEntries } from "@/features/body/entries";
import { EntryDateFilter, useEntryDates } from "@/features/trends/EntryDateFilter";
import { useListVersion } from "@/app/MasterDetail";
import { apiFetch, errorMessage } from "@/api/client";
import type { SleepEntry } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, PageHeading } from "@/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { SLEEP_QUALITY_SCALE, scaleText } from "@/lib/scales";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function SleepView() {
  const listVersion = useListVersion();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { from, to, suffix } = useEntryDates();
  const [deleteTarget, setDeleteTarget] = useState<SleepEntry | null>(null);
  const entriesQuery = useSleepEntries(from, to, listVersion);
  const entries = entriesQuery.data ?? [];

  async function deleteEntry(entry: SleepEntry) {
    try {
      await apiFetch(`/sleep-entries/${entry.id}`, { method: "DELETE" });
      toast.success("Deleted entry");
      void queryClient.invalidateQueries({ queryKey: ["sleep-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["sleep-trends"] });
    } catch (err) {
      toast.error(`Failed to delete: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="sleep-view">
      <div className="mb-5 flex items-start justify-between gap-3 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <PageHeading hint="Track sleep duration and quality over time.">Sleep</PageHeading>
        <Button variant="primary" onClick={() => void navigate(`/sleep/new${suffix}`)}>
          Log sleep
        </Button>
      </div>

      <EntryDateFilter clearTo="/sleep" />
      <ul id="sleep-entries-list" className="flex flex-col gap-3">
        {entriesQuery.error ? <li className="text-sm text-danger">{errorMessage(entriesQuery.error)}</li> : null}
        {entriesQuery.isSuccess && entries.length === 0 ? (
          <li>
            <EmptyState
              title={suffix ? "No sleep entries in this date range" : "No sleep entries yet"}
              description="Tap 'Log sleep' to record last night's sleep."
            />
          </li>
        ) : null}
        {entries.map((entry) => (
          <li key={entry.id} className="block-flat flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="font-medium tabular-nums">
                {formatDate(entry.sleep_date)}
                <span className="ml-2 text-sm font-normal text-muted">
                  {formatDuration(entry.time_in_bed_seconds)} in bed
                </span>
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {formatDateTime(entry.sleep_start)} →{" "}
                {formatDateTime(entry.sleep_end)}
                {entry.quality_score != null
                  ? ` · Quality ${scaleText(SLEEP_QUALITY_SCALE, entry.quality_score)}`
                  : ""}
              </p>
              {entry.notes ? <p className="mt-0.5 text-sm text-muted">{entry.notes}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void navigate(`/sleep/${entry.id}/edit${suffix}`)}>Edit</Button>
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
