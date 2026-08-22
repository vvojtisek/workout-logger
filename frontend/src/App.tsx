import { useCallback, useEffect, useState } from "react";

import { apiFetch, getStoredApiKey } from "@/api/client";
import type { WorkoutSession } from "@/api/types";
import { ActiveWorkoutView } from "@/features/active-workout/ActiveWorkoutView";
import { HistoryView } from "@/features/history/HistoryView";
import { LogDetailView } from "@/features/history/LogDetailView";
import { NewLogView } from "@/features/logs/NewLogView";
import { PlansView } from "@/features/plans/PlansView";
import { SettingsView } from "@/features/settings/SettingsView";

export type ViewId =
  | "settings-view"
  | "plans-view"
  | "active-workout-view"
  | "new-log-view"
  | "history-view"
  | "detail-view";

const NAV_ITEMS: { view: ViewId; label: string; glyph: string }[] = [
  { view: "settings-view", label: "API Key", glyph: "🔑" },
  { view: "plans-view", label: "Plans", glyph: "📋" },
  { view: "new-log-view", label: "New Workout", glyph: "➕" },
  { view: "history-view", label: "History", glyph: "🗂" },
];

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

export function App() {
  const [view, setView] = useState<ViewId>("settings-view");
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [detailLogId, setDetailLogId] = useState<string | null>(null);
  const [historyReloadToken, setHistoryReloadToken] = useState(0);
  const online = useOnlineStatus();

  const openSession = useCallback((next: WorkoutSession) => {
    setSession(next);
    setView("active-workout-view");
  }, []);

  const finishSession = useCallback(() => {
    setSession(null);
    setHistoryReloadToken((token) => token + 1);
    setView("history-view");
  }, []);

  // A session left running on another device or before a reload is resumable;
  // no resumable session is a normal initial state, not an error.
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

  const showGlobalNav = view !== "active-workout-view";

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-base font-semibold tracking-tight">Workout Logger</h1>
          <span
            id="connection-status"
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              online
                ? "bg-success-soft text-success"
                : "bg-danger-soft text-danger"
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
              const active = view === item.view;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => setView(item.view)}
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
        {view === "settings-view" ? <SettingsView /> : null}
        {view === "plans-view" ? <PlansView onSessionStarted={openSession} /> : null}
        {view === "new-log-view" ? (
          <NewLogView
            online={online}
            onSaved={() => {
              setHistoryReloadToken((token) => token + 1);
              setView("history-view");
            }}
          />
        ) : null}
        {view === "history-view" ? (
          <HistoryView
            reloadToken={historyReloadToken}
            onOpenLog={(logId) => {
              setDetailLogId(logId);
              setView("detail-view");
            }}
          />
        ) : null}
        {view === "detail-view" ? (
          <LogDetailView
            logId={detailLogId}
            onBack={() => {
              setHistoryReloadToken((token) => token + 1);
              setView("history-view");
            }}
          />
        ) : null}
        {view === "active-workout-view" && session ? (
          <ActiveWorkoutView
            session={session}
            online={online}
            onSessionChange={setSession}
            onFinished={finishSession}
          />
        ) : null}
      </main>
    </div>
  );
}
