import { useState } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { LocationCheck, WorkoutSession } from "@/api/types";
import { describeEquipmentOptions } from "@/lib/equipment";
import { Dialog } from "@/ui/Dialog";

/** Shown right after starting a workout at a location: each exercise the
 * place can't host, with one-tap swaps. Keeping an exercise is always fine. */
export function LocationCheckDialog({
  session,
  check,
  onDone,
}: {
  session: WorkoutSession;
  check: LocationCheck;
  onDone: (session: WorkoutSession) => void;
}) {
  const [latest, setLatest] = useState(session);
  const [items, setItems] = useState(check.items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function swap(item: LocationCheck["items"][number], index: number) {
    const choice = item.swaps[index];
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiFetch<WorkoutSession>(
        `/workout-sessions/${latest.id}/exercises/${item.session_exercise_id}`,
        { method: "PATCH", body: JSON.stringify(choice) },
      );
      setLatest(updated);
      setItems((current) =>
        current.filter((other) => other.session_exercise_id !== item.session_exercise_id),
      );
    } catch (err) {
      setError(`Failed to swap: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const place = check.location?.name ?? "this location";
  return (
    <Dialog open onClose={() => onDone(latest)} title={`Training at ${place}`}>
      <p className="text-sm text-muted">
        {items.length === 0
          ? "Everything in this workout works here."
          : `${place} is missing equipment for ${items.length === 1 ? "this exercise" : "these exercises"}. Swap for this workout only, or keep it.`}
      </p>
      <ul className="flex flex-col gap-3" aria-label="Exercises to check">
        {items.map((item) => (
          <li key={item.session_exercise_id} className="rounded-lg border border-line-muted p-3">
            <p className="font-medium">{item.exercise_name}</p>
            <p className="text-sm text-muted">Needs {describeEquipmentOptions(item.needs)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.swaps.map((choice, index) => (
                <button
                  key={choice.exercise_name}
                  type="button"
                  className="btn btn-secondary btn-touch"
                  disabled={busy}
                  onClick={() => void swap(item, index)}
                >
                  {choice.exercise_name}
                </button>
              ))}
              {item.swaps.length === 0 ? (
                <p className="text-sm text-muted">No catalogue exercise fits here.</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button type="button" className="btn btn-primary btn-touch" onClick={() => onDone(latest)}>
          {items.length === 0 ? "Start workout" : "Keep the rest and start"}
        </button>
      </div>
    </Dialog>
  );
}
