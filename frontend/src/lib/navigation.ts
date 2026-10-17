/** The app's navigation model. Desktop and mobile group the same pages
 * differently: desktop has a rail of named destinations, mobile has five
 * thumb-sized tabs around a central Log button. Every page appears in exactly
 * one section of each layout, and a section with more than one page shows
 * them as sub-tabs. */

export interface NavPage {
  path: string;
  label: string;
}

export type NavIcon =
  | "today"
  | "log"
  | "workout"
  | "plans"
  | "calendar"
  | "history"
  | "exercises"
  | "nutrition"
  | "body"
  | "tokens"
  | "settings"
  | "more";

export interface NavSection {
  id: string;
  label: string;
  icon: NavIcon;
  pages: NavPage[];
}

export const WORKOUT_PATH = "/workout";
export const TODAY_PATH = "/today";
/** The mobile section drawn as the central Log button, which opens a sheet
 * of quick entries instead of leading to one page. */
export const LOG_SECTION_ID = "log";

const PAGES = {
  today: { path: TODAY_PATH, label: "Today" },
  newWorkout: { path: "/log/new", label: "New Workout" },
  logActivity: { path: "/activity/new", label: "Log Activity" },
  plans: { path: "/plans", label: "Plans" },
  programs: { path: "/programs", label: "Programs" },
  calendar: { path: "/calendar", label: "Calendar" },
  schedule: { path: "/schedule", label: "Sport schedule" },
  history: { path: "/history", label: "History" },
  exercises: { path: "/exercises", label: "Exercises" },
  locations: { path: "/locations", label: "Locations" },
  nutrition: { path: "/nutrition", label: "Nutrition" },
  biometrics: { path: "/biometrics", label: "Biometrics" },
  sleep: { path: "/sleep", label: "Sleep" },
  tokens: { path: "/tokens", label: "Tokens" },
  settings: { path: "/settings", label: "Settings" },
} satisfies Record<string, NavPage>;

export const DESKTOP_SECTIONS: NavSection[] = [
  {
    id: "today",
    label: "Today",
    icon: "today",
    pages: [PAGES.today],
  },
  {
    id: "workout",
    label: "Active Workout",
    icon: "workout",
    pages: [PAGES.newWorkout, PAGES.logActivity],
  },
  {
    id: "plans",
    label: "Programs & Plans",
    icon: "plans",
    pages: [PAGES.plans, PAGES.programs],
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: "calendar",
    pages: [PAGES.calendar, PAGES.schedule],
  },
  {
    id: "history",
    label: "Workout History",
    icon: "history",
    pages: [PAGES.history],
  },
  {
    id: "exercises",
    label: "Exercise Catalogue",
    icon: "exercises",
    pages: [PAGES.exercises, PAGES.locations],
  },
  {
    id: "nutrition",
    label: "Nutrition & Meals",
    icon: "nutrition",
    pages: [PAGES.nutrition],
  },
  {
    id: "body",
    label: "Body Metrics & Sleep",
    icon: "body",
    pages: [PAGES.biometrics, PAGES.sleep],
  },
];

export const DESKTOP_FOOTER_SECTIONS: NavSection[] = [
  {
    id: "tokens",
    label: "API & MCP Tokens",
    icon: "tokens",
    pages: [PAGES.tokens],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    pages: [PAGES.settings],
  },
];

export const MOBILE_SECTIONS: NavSection[] = [
  {
    id: "today",
    label: "Today",
    icon: "today",
    pages: [PAGES.today],
  },
  {
    id: "history",
    label: "History",
    icon: "history",
    pages: [PAGES.history, PAGES.calendar],
  },
  {
    id: LOG_SECTION_ID,
    label: "Log",
    icon: "log",
    pages: [PAGES.newWorkout, PAGES.logActivity],
  },
  {
    id: "coach",
    label: "Coach",
    icon: "plans",
    pages: [
      PAGES.plans,
      PAGES.programs,
      PAGES.exercises,
      PAGES.locations,
      PAGES.schedule,
    ],
  },
  {
    id: "more",
    label: "More",
    icon: "more",
    pages: [
      PAGES.nutrition,
      PAGES.biometrics,
      PAGES.sleep,
      PAGES.settings,
      PAGES.tokens,
    ],
  },
];

function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The page a pathname belongs to: the longest matching page path, so
 * `/nutrition/foods/new` belongs to Nutrition and `/plans/x/edit` to Plans. */
export function pageForPath(
  sections: NavSection[],
  pathname: string,
): NavPage | null {
  let best: NavPage | null = null;
  for (const section of sections) {
    for (const page of section.pages) {
      if (
        matchesPath(pathname, page.path) &&
        (!best || page.path.length > best.path.length)
      ) {
        best = page;
      }
    }
  }
  return best;
}

/** The section a pathname belongs to. The live workout belongs to the section
 * that starts workouts. */
export function sectionForPath(
  sections: NavSection[],
  pathname: string,
): NavSection | null {
  if (matchesPath(pathname, WORKOUT_PATH)) {
    return (
      sections.find((section) => section.pages.includes(PAGES.newWorkout)) ??
      null
    );
  }
  const page = pageForPath(sections, pathname);
  if (!page) return null;
  return sections.find((section) => section.pages.includes(page)) ?? null;
}

/** Where a section's nav entry leads. The workout section returns to a live
 * session instead of starting a new one. */
export function sectionTarget(
  section: NavSection,
  sessionActive: boolean,
): string {
  if (sessionActive && section.pages.includes(PAGES.newWorkout))
    return WORKOUT_PATH;
  return section.pages[0]?.path ?? "/";
}
