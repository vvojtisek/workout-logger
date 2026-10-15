import { useEffect, useState } from "react";

import { restTimerState } from "@/lib/active-workout-state";
import { remainingTimeSeconds } from "@/lib/workout-utils";
import type { SynchronizationState } from "@/lib/active-workout-state";

/** Ticks once a second while mounted. Remaining time is always derived from
 * the server's absolute `rest_ends_at`, so backgrounding, reloading, or a slow
 * tick can never drift the timer. */
export function useRestCountdown(restEndsAt: string | null) {
  const [now, setNow] = useState(() => new Date());

  // Resynchronise the instant rest starts, changes, or is skipped - not just on
  // the next tick. Without the immediate resync the first frame after a set is
  // saved would count down from a `now` captured when the overlay mounted,
  // briefly showing more time remaining than there actually is.
  useEffect(() => {
    setNow(new Date());
    const handle = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(handle);
  }, [restEndsAt]);

  const state = restTimerState(restEndsAt, now);
  return {
    state,
    expired: state.status === "expired",
    remainingSeconds: remainingTimeSeconds(restEndsAt, now),
  };
}

/**
 * The desktop rest card, docked beside the set table. It owns its own
 * one-second tick so that ticking re-renders only this card, never the set
 * table. Remaining time is
 * always derived from the server's absolute `rest_ends_at`, so backgrounding,
 * reloading, or a slow tick can never drift the timer.
 */
export function RestOverlay({
  restEndsAt,
  restWasSkipped,
  sync,
  onAdjust,
  onSkip,
  onRetrySync,
}: {
  restEndsAt: string | null;
  restWasSkipped: boolean;
  sync: SynchronizationState;
  onAdjust: (seconds: number) => void;
  onSkip: () => void;
  onRetrySync: () => void;
}) {
  const { state, expired } = useRestCountdown(restEndsAt);
  const label = restWasSkipped && !restEndsAt ? "Rest skipped" : state.label;
  const canAdjust = Boolean(restEndsAt);

  return (
    <aside
      id="active-rest-overlay"
      aria-label="Rest timer"
      className="card flex flex-col gap-3 p-4"
    >
      <div className="flex flex-col gap-3">
        <div>
          <p
            id="active-rest-timer"
            role="timer"
            aria-live="polite"
            className={`font-mono text-[32px] leading-none font-semibold ${expired ? "text-success" : ""}`}
            data-numeric
          >
            {expired ? "Rest: 0s" : label}
          </p>
          <p
            id="active-rest-expired"
            role="status"
            aria-live="assertive"
            className="mt-1 text-sm font-semibold text-success"
            hidden={!expired}
          >
            Rest complete
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            id="subtract-rest-time"
            aria-label="−15 seconds"
            disabled={!canAdjust}
            onClick={() => onAdjust(-15)}
            className="btn btn-secondary btn-touch"
          >
            −15s
          </button>
          <button
            type="button"
            id="add-rest-time"
            aria-label="+15 seconds"
            disabled={!canAdjust}
            onClick={() => onAdjust(15)}
            className="btn btn-secondary btn-touch"
          >
            +15s
          </button>
          <button
            type="button"
            id="skip-rest"
            disabled={!canAdjust}
            onClick={onSkip}
            className="btn btn-secondary btn-touch"
          >
            Skip rest
          </button>
        </div>
        <div className="flex items-center gap-2">
          <p
            id="active-sync-status"
            aria-live="polite"
            data-state={sync.status}
            className={`flex-1 text-sm ${
              sync.status === "failed"
                ? "text-danger"
                : sync.status === "pending"
                  ? "text-warn"
                  : "text-muted"
            }`}
          >
            {sync.label}
          </p>
          <button
            type="button"
            id="retry-active-sync"
            hidden={sync.status !== "failed"}
            onClick={onRetrySync}
            className="btn btn-secondary btn-touch"
          >
            Retry synchronization
          </button>
        </div>
      </div>
    </aside>
  );
}
