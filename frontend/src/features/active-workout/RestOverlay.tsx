import { useEffect, useState } from "react";

import { restTimerState } from "@/lib/active-workout-state";
import type { SynchronizationState } from "@/lib/active-workout-state";

/**
 * The rest countdown owns its own one-second tick so that ticking re-renders
 * only this overlay, never the logging grid underneath it. Remaining time is
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
  const expired = state.status === "expired";
  const label = restWasSkipped && !restEndsAt ? "Rest skipped" : state.label;
  const canAdjust = Boolean(restEndsAt);

  return (
    <aside
      id="active-rest-overlay"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border-subtle bg-surface-raised shadow-lg pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1">
            <p
              id="active-rest-timer"
              role="timer"
              aria-live="polite"
              className={`text-lg font-semibold ${expired ? "text-success" : ""}`}
              data-numeric
            >
              {expired ? "Rest: 0s" : label}
            </p>
            <p
              id="active-rest-expired"
              role="status"
              aria-live="assertive"
              className="text-sm font-semibold text-success"
              hidden={!expired}
            >
              Rest complete
            </p>
          </div>
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
