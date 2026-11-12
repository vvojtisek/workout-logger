import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useListVersion } from "@/app/MasterDetail";
import { apiFetch, errorMessage } from "@/api/client";
import type { Paginated, Program } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, PageHeading } from "@/ui";

import { ProgramTemplates } from "./ProgramTemplates";
import { formatDate } from "@/lib/format";
import { localIsoDate } from "@/lib/today";
import { programWeekProgress } from "@/lib/program-week";

const STATUS_LABELS: Record<Program["status"], string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

export function ProgramsView() {
  const listVersion = useListVersion();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Program | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Paginated<Program>>("/programs?limit=100");
      setPrograms(data.items);
      setError(null);
    } catch (err) {
      setError(`Failed to load programs: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload after the detail beside the list closes (see MasterDetail).
  useEffect(() => {
    void load();
  }, [load, listVersion]);

  async function deleteProgram(program: Program) {
    try {
      await apiFetch(`/programs/${program.id}`, { method: "DELETE" });
      toast.success(`Deleted "${program.name}"`);
      void load();
      void queryClient.invalidateQueries({ queryKey: ["plans"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    } catch (err) {
      toast.error(`Failed to delete program: ${errorMessage(err)}`);
    }
  }

  return (
    <section id="programs-view">
      <div className="mb-5 flex items-start justify-between gap-3 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <PageHeading hint="Named date-range blocks. Overlapping programs are allowed.">
          Programs
        </PageHeading>
        <Button variant="primary" onClick={() => void navigate("/programs/new")}>
          New program
        </Button>
      </div>
      <ul id="programs-list" className="flex flex-col gap-3">
        {error ? <li className="text-sm text-danger">{error}</li> : null}
        {!error && !loading && programs.length === 0 ? (
          <li>
            <EmptyState
              title="No programs yet"
              description="Tap 'New program', or add a ready-made program below."
            />
          </li>
        ) : null}
        {programs.map((program) => (
          <li
            key={program.id}
            aria-label={program.name}
            className="card flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <p className="font-medium">{program.name}</p>
              <p className="mt-0.5 text-sm text-muted">
                {program.kind} &middot; {formatDate(program.start_date)}
                {program.end_date ? ` – ${formatDate(program.end_date)}` : " – ongoing"}
              </p>
              <p className="mt-1 text-xs text-muted">{STATUS_LABELS[program.status]}</p>
              <ProgramWeekSummary program={program} />
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button onClick={() => void navigate(`/programs/${program.id}/edit`)}>Edit</Button>
              <Button variant="ghost" onClick={() => setDeleteTarget(program)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ProgramTemplates onInstalled={() => void load()} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteProgram(deleteTarget);
        }}
        title="Delete program"
        message={`Delete "${deleteTarget?.name}"? Its planned sessions are removed from the calendar, along with any plans it created. Workouts you already logged stay in History.`}
        confirmLabel="Delete"
      />
    </section>
  );
}

function ProgramWeekSummary({ program }: { program: Program }) {
  const progress = programWeekProgress(
    program.start_date,
    program.end_date,
    localIsoDate(new Date()),
  );
  let label: string;
  if (progress.state === "upcoming") {
    label = `Starts in ${progress.daysUntilStart} ${progress.daysUntilStart === 1 ? "day" : "days"}`;
  } else if (progress.totalWeeks === null) {
    label = `Week ${progress.week} · ongoing`;
  } else if (progress.state === "ended") {
    label = `Block ended · Week ${progress.week} of ${progress.totalWeeks}`;
  } else {
    label = `Week ${progress.week} of ${progress.totalWeeks} · ${progress.elapsedPercent}% elapsed`;
  }

  return (
    <div className="mt-2 max-w-xs" data-testid="program-week-summary">
      <p className="text-xs font-medium" data-numeric>{label}</p>
      {progress.elapsedPercent !== null && progress.state !== "upcoming" ? (
        <div
          role="progressbar"
          aria-label={`${program.name} block duration`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.elapsedPercent}
          aria-valuetext={`${label}`}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${progress.elapsedPercent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
