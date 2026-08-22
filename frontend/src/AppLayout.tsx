import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { apiFetch, getStoredApiKey } from "@/api/client";
import type { WorkoutSession } from "@/api/types";
import { Toaster } from "@/ui/Toast";

interface AppContextValue {
  session: WorkoutSession | null;
  online: boolean;
  openSession: (session: WorkoutSession) => void;
  updateSession: (session: WorkoutSession) => void;
  finishSession: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppLayout");
  return ctx;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

const NAV_ITEMS: { path: string; label: string; glyph: string }[] = [
  { path: "/settings", label: "API Key", glyph: "\u{1F511}" },
  { path: "/plans", label: "Plans", glyph: "\u{1F4CB}" },
  { path: "/exercises", label: "Exercises", glyph: "\u{1F4AA}" },
  { path: "/log/new", label: "New Workout", glyph: "➕" },
  { path: "/history", label: "History", glyph: "\u{1F5C2}" },
];

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnlineStatus();
  const [session, setSession] = useState<WorkoutSession | null>(null);

  const openSession = useCallback(
    (next: WorkoutSession) => {
      setSession(next);
      void navigate("/workout");
    },
    [navigate],
  );

  const finishSession = useCallback(() => {
    setSession(null);
    void navigate("/history");
  }, [navigate]);

  const updateSession = useCallback((next: WorkoutSession) => {
    setSession(next);
  }, []);

  useEffect(() => {
    if (!getStoredApiKey()) return;
    let cancelled = false;
    apiFetch<WorkoutSession>("/workout-sessions/active")
      .then((active) => {
        if (!cancelled) openSession(active);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [openSession]);

  const showGlobalNav = location.pathname !== "/workout";

  const ctx: AppContextValue = { session, online, openSession, updateSession, finishSession };

  return (
    <AppContext.Provider value={ctx}>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface/90 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <h1 className="text-base font-semibold tracking-tight">Workout Logger</h1>
            <span
              id="connection-status"
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                online ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
              }`}
            >
              {online ? "online" : "offline"}
            </span>
          </div>
        </header>

        {showGlobalNav ? (
          <nav
            aria-label="Main navigation"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface pb-[env(safe-area-inset-bottom)] md:sticky md:top-[57px] md:border-b md:border-t-0 md:pb-0"
          >
            <div className="mx-auto flex max-w-3xl">
              {NAV_ITEMS.map((item) => {
                const active = location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => void navigate(item.path)}
                    aria-current={active ? "page" : undefined}
                    className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-xs font-medium md:flex-row md:justify-center md:gap-2 md:py-2.5 md:text-sm ${
                      active ? "text-accent" : "text-muted hover:text-text"
                    }`}
                    style={{ minHeight: "var(--touch)" }}
                  >
                    <span aria-hidden="true" className="text-base leading-none">
                      {item.glyph}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>
        ) : null}

        <main className="mx-auto max-w-3xl px-4 pt-5 pb-48">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </AppContext.Provider>
  );
}
