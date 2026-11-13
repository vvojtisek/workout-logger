import { useCallback } from "react";

import { apiFetch, errorMessage } from "@/api/client";
import type { WorkoutSession } from "@/api/types";
import { formatCountdown } from "@/lib/workout-hud";
import { toast } from "@/ui/Toast";
import { useRestCountdown } from "./RestOverlay";

/**
 * The phone's rest timer. It lives in the app shell, not inside the workout
 * screen, so it stays on screen when the workout is minimized or the user
 * moves to another page, and it never takes the place of the Log button.
 *
 * Remaining time is derived from the server's absolute `rest_ends_at`
 * (see useRestCountdown), so reloads and a backgrounded tab cannot drift it.
 */
export function GlobalRestBar({
  session,
  onSessionChange,
  reserveSpace = false,
}: {
  session: WorkoutSession | null;
  onSessionChange: (session: WorkoutSession) => void;
  /** Keep the bar's height when no rest is running. The workout screen sets
   * this so starting a rest never shifts the controls above it. */
  reserveSpace?: boolean;
}) {
  const restEndsAt = session?.rest_ends_at ?? null;
  const { remainingSeconds, expired } = useRestCountdown(restEndsAt);

  const updateRest = useCallback(
    async (data: { adjustment_seconds?: number; skip?: boolean }) => {
      if (!session) return;
      try {
        const updated = await apiFetch<WorkoutSession>(
          `/workout-sessions/${session.id}/rest`,
          {
            method: "PATCH",
            body: JSON.stringify({ ...data, expected_version: session.version }),
          },
        );
        onSessionChange(updated);
      } catch (err) {
        toast.error(`Failed to update rest timer: ${errorMessage(err)}`);
      }
    },
    [session, onSessionChange],
  );

  if (!session || !restEndsAt || expired) {
    return reserveSpace && session ? (
      <div
        data-testid="rest-idle"
        className="flex h-[61px] shrink-0 items-center border-t border-line-muted px-4 text-sm text-muted"
      >
        Rest timer starts when you log a set
      </div>
    ) : null;
  }

  return (
    <div
      id="active-rest-overlay"
      data-testid="rest-bar"
      className="flex h-[61px] shrink-0 items-center gap-2 border-t border-accent bg-accent-soft px-4"
    >
      <p
        id="active-rest-timer"
        role="timer"
        aria-live="off"
        className="min-w-0 flex-1 font-mono text-lg font-bold whitespace-nowrap"
        data-numeric
      >
        RESTING — {formatCountdown(remainingSeconds)}
      </p>
      <button
        type="button"
        id="subtract-rest-time"
        aria-label="−15 seconds"
        onClick={() => void updateRest({ adjustment_seconds: -15 })}
        className="btn btn-secondary h-11 min-w-12 shrink-0 px-2 font-mono text-xs"
      >
        −15s
      </button>
      <button
        type="button"
        id="add-rest-time"
        aria-label="+15 seconds"
        onClick={() => void updateRest({ adjustment_seconds: 15 })}
        className="btn btn-secondary h-11 min-w-12 shrink-0 px-2 font-mono text-xs"
      >
        +15s
      </button>
      <button
        type="button"
        id="skip-rest"
        onClick={() => void updateRest({ skip: true })}
        className="btn btn-primary h-11 shrink-0 px-3 text-xs whitespace-nowrap"
      >
        Skip Rest
      </button>
    </div>
  );
}
