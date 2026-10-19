import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { WorkoutLog } from "@/api/types";
import { activityLabel, logSummaryFacts } from "@/lib/activity";
import { exerciseSetsText } from "@/lib/log-edit";
import { ConfirmDialog } from "@/ui/Dialog";
import { Button, Card, PageHeading } from "@/ui";
import { formatDateTime } from "@/lib/format";
import { TRAINING_LOAD_HINT } from "@/lib/scales";
import { LogEditor } from "./LogEditor";

export function LogDetailView() {
  const { logId } = useParams<{ logId: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<WorkoutLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!logId) return;
    let cancelled = false;
    setLog(null);
    setEditing(false);
    apiFetch<WorkoutLog>(`/logs/${logId}`)
      .then((data) => {
        if (!cancelled) {
          setLog(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(`Failed to load workout: ${errorMessage(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [logId]);

  async function deleteLog() {
    if (!logId) return;
    await apiFetch(`/logs/${logId}`, { method: "DELETE" });
    void navigate("/history");
  }

  return (
    <section id="detail-view">
      <Button id="back-to-history" onClick={() => void navigate("/history")} className="mb-4">
        &larr; Back to history
      </Button>
      <PageHeading>{editing ? "Edit Workout" : "Workout Detail"}</PageHeading>
      {log && editing ? (
        <LogEditor
          key={log.id}
          log={log}
          onSaved={(saved) => {
            setLog(saved);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      <div id="detail-content" className="flex flex-col gap-3" hidden={editing}>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {log && !editing ? (
          <>
            <Card className="p-4">
              <p className="text-sm text-muted" data-numeric>
                {[formatDateTime(log.performed_at), ...logSummaryFacts(log)].join(" · ")}
              </p>
              {log.activity_type ? (
                <p className="mt-1 font-medium">{activityLabel(log.activity_type)}</p>
              ) : null}
              {log.source_plan_name ? (
                <p className="mt-1 font-medium">Plan: {log.source_plan_name}</p>
              ) : null}
              {log.effort_rpe != null ? (
                <p className="mt-1 text-xs text-muted">{TRAINING_LOAD_HINT}</p>
              ) : null}
              {log.notes ? <p className="mt-2 text-sm">{log.notes}</p> : null}
            </Card>
            <ul className="flex flex-col gap-2">
              {log.exercises.map((exercise) => (
                <li key={exercise.id} className="card p-3 text-sm">
                  {exercise.exercise_name}:{" "}
                  <span data-numeric>{exerciseSetsText(exercise)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <div className="mt-4 flex gap-2" hidden={editing}>
        <Button id="edit-log-btn" variant="primary" disabled={!log} onClick={() => setEditing(true)}>
          Edit workout
        </Button>
        <Button id="delete-log-btn" variant="danger" onClick={() => setConfirmDelete(true)}>
          Delete workout
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void deleteLog()}
        title="Delete workout"
        message="Are you sure you want to delete this workout? This cannot be undone."
      />
    </section>
  );
}
