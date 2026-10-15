import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  ClipboardList,
  Dumbbell,
  Ellipsis,
  HeartPulse,
  History,
  KeyRound,
  Moon,
  Settings,
  Sun,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { apiFetch } from "@/api/client";
import type { WorkoutSession } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Toaster } from "@/ui/Toast";
import { describeBuild } from "@/lib/build-label";
import type { BuildLabel, BuildMetadata } from "@/lib/build-label";
import {
  DESKTOP_FOOTER_SECTIONS,
  DESKTOP_SECTIONS,
  MOBILE_SECTIONS,
  WORKOUT_PATH,
  pageForPath,
  sectionForPath,
  sectionTarget,
} from "@/lib/navigation";
import type { NavIcon, NavSection } from "@/lib/navigation";
import { useTheme, useThemePreference } from "@/lib/theme";
import { useIsDesktop } from "@/lib/use-media-query";

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

/** Sourced from `/health` (never cached by the service worker), itself backed by
 * the APP_VERSION/GIT_COMMIT values baked into the image or set on the container
 * -- see app/config.py. Null until the server answers. */
function useBuildLabel(online: boolean): BuildLabel | null {
  const [label, setLabel] = useState<BuildLabel | null>(null);
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    fetch("/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: BuildMetadata) => {
        if (!cancelled) setLabel(describeBuild(body));
      })
      .catch(() => {
        if (!cancelled) setLabel(describeBuild(null));
      });
    return () => {
      cancelled = true;
    };
  }, [online]);
  return label;
}

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnlineStatus();
  const buildLabel = useBuildLabel(online);
  const { logout } = useAuth();
  const [session, setSession] = useState<WorkoutSession | null>(null);

  const handleLogout = useCallback(() => {
    void logout().then(() => navigate("/login"));
  }, [logout, navigate]);

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

  const isDesktop = useIsDesktop();
  const ctx: AppContextValue = {
    session,
    online,
    openSession,
    updateSession,
    finishSession,
  };
  const status = <ConnectionStatus online={online} buildLabel={buildLabel} />;
  const logoutButton = (
    <button
      id="logout-btn"
      type="button"
      onClick={handleLogout}
      className="whitespace-nowrap text-xs font-medium text-muted hover:text-main"
    >
      Log out
    </button>
  );

  return (
    <AppContext.Provider value={ctx}>
      {isDesktop ? (
        <DesktopShell
          pathname={location.pathname}
          sessionActive={session !== null}
          status={status}
          logoutButton={logoutButton}
        />
      ) : (
        <MobileShell
          pathname={location.pathname}
          sessionActive={session !== null}
          status={status}
          logoutButton={logoutButton}
        />
      )}
      <Toaster />
    </AppContext.Provider>
  );
}

function ConnectionStatus({
  online,
  buildLabel,
}: {
  online: boolean;
  buildLabel: BuildLabel | null;
}) {
  return (
    <span
      id="connection-status"
      title={online && buildLabel ? buildLabel.description : undefined}
      aria-label={
        online && buildLabel ? `Online. ${buildLabel.description}` : undefined
      }
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
        online ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
      }`}
    >
      {online ? "online" : "offline"}
      {online && buildLabel ? (
        <span id="build-version" data-build-kind={buildLabel.kind} data-numeric>
          {` · ${buildLabel.text}`}
        </span>
      ) : null}
    </span>
  );
}

const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  workout: Activity,
  plans: ClipboardList,
  calendar: CalendarDays,
  history: History,
  exercises: Dumbbell,
  nutrition: Utensils,
  body: HeartPulse,
  tokens: KeyRound,
  settings: Settings,
  more: Ellipsis,
};

function SectionIcon({ section, size }: { section: NavSection; size: number }) {
  const Icon = NAV_ICONS[section.icon];
  return <Icon aria-hidden="true" size={size} strokeWidth={1.75} />;
}

interface ShellProps {
  pathname: string;
  sessionActive: boolean;
  status: ReactNode;
  logoutButton: ReactNode;
}

/** Pulses beside the workout entry while a session is live. */
function LiveBadge() {
  return (
    <span
      aria-hidden="true"
      title="Workout in progress"
      data-testid="live-workout-badge"
      className="inline-block h-2 w-2 animate-pulse rounded-full bg-success"
    />
  );
}

/** Sub-tabs for a section that groups several pages. */
function SectionPages({
  section,
  pathname,
}: {
  section: NavSection | null;
  pathname: string;
}) {
  if (!section || section.pages.length < 2) return null;
  const current = pageForPath([section], pathname);
  return (
    <nav
      aria-label="Section pages"
      className="flex gap-1 overflow-x-auto border-b border-line-muted"
    >
      {section.pages.map((page) => {
        const active = current?.path === page.path;
        return (
          <Link
            key={page.path}
            to={page.path}
            aria-current={active ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${
              active
                ? "border-accent text-main"
                : "border-transparent text-muted hover:text-main"
            }`}
          >
            {page.label}
          </Link>
        );
      })}
    </nav>
  );
}

function RailLink({
  section,
  active,
  sessionActive,
}: {
  section: NavSection;
  active: boolean;
  sessionActive: boolean;
}) {
  const live = sessionActive && section.id === "workout";
  return (
    <Link
      to={sectionTarget(section, sessionActive)}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 border-l-[3px] px-4 py-2.5 text-sm font-medium ${
        active
          ? "border-accent bg-elevated text-main"
          : "border-transparent text-muted hover:bg-elevated/60 hover:text-main"
      }`}
    >
      <SectionIcon section={section} size={17} />
      <span className="flex-1">{section.label}</span>
      {live ? <LiveBadge /> : null}
    </Link>
  );
}

function ThemeToggle() {
  const theme = useTheme();
  const [, setPreference] = useThemePreference();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="rounded-[var(--radius-sm)] px-2 py-1 text-sm text-muted hover:bg-elevated hover:text-main"
    >
      {theme === "dark" ? (
        <Moon aria-hidden="true" size={16} strokeWidth={1.75} />
      ) : (
        <Sun aria-hidden="true" size={16} strokeWidth={1.75} />
      )}
    </button>
  );
}

/** >= 1024px: a fixed nav rail and a full-height workspace, no centred column. */
function DesktopShell({
  pathname,
  sessionActive,
  status,
  logoutButton,
}: ShellProps) {
  const sections = [...DESKTOP_SECTIONS, ...DESKTOP_FOOTER_SECTIONS];
  const current = sectionForPath(sections, pathname);
  return (
    <div className="grid h-dvh w-screen grid-cols-[220px_1fr] overflow-hidden">
      <aside className="flex min-h-0 flex-col border-r border-line-muted bg-canvas">
        <p className="px-4 pt-5 pb-4 text-base font-semibold tracking-tight">
          Workout Logger
        </p>
        <nav
          aria-label="Main navigation"
          className="flex min-h-0 flex-1 flex-col justify-between overflow-y-auto"
        >
          <div className="flex flex-col">
            {DESKTOP_SECTIONS.map((section) => (
              <RailLink
                key={section.id}
                section={section}
                active={current?.id === section.id}
                sessionActive={sessionActive}
              />
            ))}
          </div>
          <div className="flex flex-col pb-2">
            {DESKTOP_FOOTER_SECTIONS.map((section) => (
              <RailLink
                key={section.id}
                section={section}
                active={current?.id === section.id}
                sessionActive={sessionActive}
              />
            ))}
          </div>
        </nav>
        <div className="flex flex-col gap-2 border-t border-line-muted px-4 py-3">
          <div className="flex items-center justify-between">
            <ThemeToggle />
            {logoutButton}
          </div>
          <div>{status}</div>
        </div>
      </aside>
      <main className="min-h-0 overflow-y-auto bg-surface">
        <div className="px-8">
          <SectionPages section={current} pathname={pathname} />
        </div>
        <div className="max-w-5xl px-8 pt-6 pb-16">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** < 1024px: 48px top bar, scrolling content, 60px five-tab bottom bar. The
 * live workout hides the tabs so the session has the whole screen. */
function MobileShell({
  pathname,
  sessionActive,
  status,
  logoutButton,
}: ShellProps) {
  const current = sectionForPath(MOBILE_SECTIONS, pathname);
  const inWorkout = pathname === WORKOUT_PATH;
  // The live workout is a full-screen HUD: no top bar, no tabs.
  if (inWorkout) {
    return (
      <main className="h-dvh overflow-hidden">
        <Outlet />
      </main>
    );
  }
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line-muted bg-surface px-4">
        <p className="min-w-0 truncate text-base font-semibold tracking-tight">
          {current?.label ?? "Workout Logger"}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          {status}
          {logoutButton}
        </div>
      </header>
      {inWorkout ? null : (
        <div className="shrink-0 bg-surface px-2">
          <SectionPages section={current} pathname={pathname} />
        </div>
      )}
      <main
        className={`min-h-0 flex-1 overflow-y-auto px-4 pt-4 ${inWorkout ? "pb-48" : "pb-8"}`}
      >
        <Outlet />
      </main>
      {inWorkout ? null : (
        <nav
          aria-label="Main navigation"
          className="grid h-[60px] shrink-0 grid-cols-5 border-t border-line-muted bg-surface pb-[env(safe-area-inset-bottom)]"
        >
          {MOBILE_SECTIONS.map((section) => {
            const active = current?.id === section.id;
            const live = sessionActive && section.id === "train";
            return (
              <Link
                key={section.id}
                to={sectionTarget(section, sessionActive)}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <SectionIcon section={section} size={20} />
                {section.label}
                {live ? (
                  <span className="absolute top-2 right-[30%]">
                    <LiveBadge />
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
