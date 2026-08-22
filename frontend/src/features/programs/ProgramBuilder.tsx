import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { Program, ProgramStatus } from "@/api/types";
import { programPayloadSchema } from "@/lib/program-schema";
import { Button, Card, Input, PageHeading } from "@/ui";
import { toast } from "@/ui/Toast";

const STATUS_OPTIONS: { value: ProgramStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

function buildPayload(state: {
  name: string;
  kind: string;
  start_date: string;
  end_date: string;
  status: ProgramStatus;
  notes: string;
}) {
  return {
    name: state.name.trim(),
    kind: state.kind.trim(),
    start_date: state.start_date,
    end_date: state.end_date || null,
    status: state.status,
    notes: state.notes.trim() || null,
  };
}

export function ProgramBuilder() {
  const { programId } = useParams<{ programId: string }>();
  const isEditing = Boolean(programId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<ProgramStatus>("active");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seededProgramId = useRef<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["program", programId],
    queryFn: () => apiFetch<Program>(`/programs/${programId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existing || seededProgramId.current === existing.id) return;
    seededProgramId.current = existing.id;
    setName(existing.name);
    setKind(existing.kind);
    setStartDate(existing.start_date);
    setEndDate(existing.end_date ?? "");
    setStatus(existing.status);
    setNotes(existing.notes ?? "");
  }, [existing]);

  const mutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isEditing
        ? apiFetch<Program>(`/programs/${programId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          })
        : apiFetch<Program>("/programs", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (program) => {
      void queryClient.invalidateQueries({ queryKey: ["programs"] });
      toast.success(isEditing ? `Updated "${program.name}"` : `Created "${program.name}"`);
      void navigate("/programs");
    },
    onError: (err: unknown) => {
      toast.error(`Failed to save program: ${errorMessage(err)}`);
    },
  });

  function submit() {
    const payload = buildPayload({ name, kind, start_date: startDate, end_date: endDate, status, notes });
    const result = programPayloadSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        nextErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(nextErrors);
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  if (isEditing && isLoading) {
    return (
      <section id="program-builder-view">
        <PageHeading>{isEditing ? "Edit Program" : "New Program"}</PageHeading>
        <p className="text-sm text-muted">Loading program…</p>
      </section>
    );
  }

  return (
    <section id="program-builder-view">
      <PageHeading hint="A named date-range block, e.g. 'Hypertrophy' or 'Hockey Pre-Season'.">
        {isEditing ? "Edit Program" : "New Program"}
      </PageHeading>

      <Card className="flex flex-col gap-4 p-4">
        <div>
          <label className="field-label" htmlFor="program-name">
            Name
          </label>
          <Input id="program-name" value={name} onChange={(event) => setName(event.target.value)} />
          {errors.name ? <p className="mt-1 text-sm text-danger">{errors.name}</p> : null}
        </div>

        <div>
          <label className="field-label" htmlFor="program-kind">
            Kind
          </label>
          <Input
            id="program-kind"
            placeholder="e.g. Hypertrophy"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          />
          {errors.kind ? <p className="mt-1 text-sm text-danger">{errors.kind}</p> : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="program-start-date">
              Start date
            </label>
            <Input
              id="program-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            {errors.start_date ? (
              <p className="mt-1 text-sm text-danger">{errors.start_date}</p>
            ) : null}
          </div>
          <div>
            <label className="field-label" htmlFor="program-end-date">
              End date (optional)
            </label>
            <Input
              id="program-end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
            {errors.end_date ? (
              <p className="mt-1 text-sm text-danger">{errors.end_date}</p>
            ) : null}
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="program-status">
            Status
          </label>
          <select
            id="program-status"
            className="input"
            value={status}
            onChange={(event) => setStatus(event.target.value as ProgramStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="program-notes">
            Notes (optional)
          </label>
          <textarea
            id="program-notes"
            className="input"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </Card>

      <div className="mt-5 flex gap-2">
        <Button
          id="save-program-btn"
          variant="primary"
          disabled={mutation.isPending}
          onClick={submit}
        >
          {isEditing ? "Save changes" : "Create program"}
        </Button>
        <Button onClick={() => void navigate("/programs")}>Cancel</Button>
      </div>
    </section>
  );
}
