import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Paginated, Program } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { toast } from "@/ui/Toast";
import { Button, EmptyState, PageHeading } from "@/ui";

import { ProgramTemplates } from "./ProgramTemplates";
import { formatDate } from "@/lib/format";

const STATUS_LABELS: Record<Program["status"], string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

export function ProgramsView() {
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

  useEffect(() => {
    void load();
  }, [load]);

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
      <div className="mb-5 flex items-start justify-between gap-3">
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
