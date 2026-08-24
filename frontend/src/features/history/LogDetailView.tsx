import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch, errorMessage } from "@/api/client";
import type { WorkoutLog } from "@/api/types";
import { ConfirmDialog } from "@/ui/Dialog";
import { Button, Card, PageHeading } from "@/ui";

export function LogDetailView() {
  const { logId } = useParams<{ logId: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<WorkoutLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!logId) return;
    let cancelled = false;
    setLog(null);
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
      <PageHeading>Workout Detail</PageHeading>
      <div id="detail-content" className="flex flex-col gap-3">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {log ? (
          <>
            <Card className="p-4">
              <p className="text-sm text-muted" data-numeric>
                {new Date(log.performed_at).toLocaleString()} · {log.total_time_minutes} min ·
                Feeling {log.overall_feeling}/5
              </p>
              {log.source_plan_name ? (
                <p className="mt-1 font-medium">Plan: {log.source_plan_name}</p>
              ) : null}
              {log.notes ? <p className="mt-2 text-sm">{log.notes}</p> : null}
            </Card>
            <ul className="flex flex-col gap-2">
              {log.exercises.map((exercise) => (
                <li key={exercise.id} className="card p-3 text-sm" data-numeric>
                  {exercise.exercise_name}: {exercise.reps_per_set.join(", ")} reps
                  {exercise.weight_kg ? ` @ ${exercise.weight_kg}kg` : ""}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <div className="mt-4 flex gap-2">
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
