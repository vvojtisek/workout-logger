import { useEffect, useState } from "react";
import { useRouteError } from "react-router-dom";

import { isChunkLoadError, shouldRetryChunkReload } from "@/lib/chunk-error";
import { Button } from "@/ui";

const RELOAD_GUARD_KEY = "wl:chunk-reload-at";
const RELOAD_GUARD_WINDOW_MS = 10_000;

export function RouteErrorBoundary() {
  const error = useRouteError();
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!isChunkLoadError(error)) return;
    const lastAttempt = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (!shouldRetryChunkReload(lastAttempt, Date.now(), RELOAD_GUARD_WINDOW_MS)) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    setReloading(true);
    window.location.reload();
  }, [error]);

  if (reloading) return null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-lg font-semibold">Something went wrong</p>
      <p className="max-w-sm text-sm text-muted">
        {isChunkLoadError(error)
          ? "A new version of the app was published. Reloading should fix this — if it keeps happening, try a hard refresh."
          : "An unexpected error occurred."}
      </p>
      <Button variant="primary" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
