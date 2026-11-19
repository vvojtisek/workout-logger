export interface NavDestination {
  path: string;
  label: string;
  aliases?: string[];
}

export interface NavPage extends NavDestination {
  children?: NavDestination[];
}

export type NavIcon = "today" | "log" | "training" | "nutrition" | "body" | "tokens" | "settings" | "more";

export interface NavSection {
  id: string;
  label: string;
  icon: NavIcon;
  pages: NavPage[];
}

export const WORKOUT_PATH = "/workout";
export const TODAY_PATH = "/today";
export const LOG_SECTION_ID = "log";

const today: NavSection = {
  id: "today",
  label: "Today",
  icon: "today",
  pages: [{ path: TODAY_PATH, label: "Today" }],
};

const training: NavSection = {
  id: "training",
  label: "Training",
  icon: "training",
  pages: [
    { path: "/training", label: "Overview", aliases: [WORKOUT_PATH, "/log/new", "/activity/new", "/activity/quick", "/recovery"] },
    {
      path: "/training/trends",
      label: "Trends",
      children: [
        { path: "/training/trends", label: "Progress" },
        { path: "/training-load", label: "Training load" },
      ],
    },
    {
      path: "/calendar",
      label: "Planning",
      children: [
        { path: "/calendar", label: "Calendar" },
        { path: "/plans", label: "Plans" },
        { path: "/programs", label: "Programs" },
        { path: "/schedule", label: "Sport schedule" },
      ],
    },
    { path: "/history", label: "Entries" },
    {
      path: "/exercises",
      label: "Library",
      children: [
        { path: "/exercises", label: "Exercises" },
        { path: "/locations", label: "Locations" },
      ],
    },
  ],
};

const nutrition: NavSection = {
  id: "nutrition",
  label: "Nutrition",
  icon: "nutrition",
  pages: [
    { path: "/nutrition", label: "Nutrition" },
    { path: "/kitchen", label: "Kitchen & Store" },
  ],
};

const body: NavSection = {
  id: "body",
  label: "Body Metrics & Sleep",
  icon: "body",
  pages: [
    { path: "/biometrics", label: "Biometrics" },
    { path: "/sleep", label: "Sleep" },
  ],
};

export const DESKTOP_SECTIONS = [today, training, nutrition, body];

export const DESKTOP_FOOTER_SECTIONS: NavSection[] = [
  {
    id: "tokens",
    label: "API & MCP Tokens",
    icon: "tokens",
    pages: [{ path: "/tokens", label: "Tokens" }],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    pages: [{ path: "/settings", label: "Settings" }],
  },
];

export const MOBILE_SECTIONS: NavSection[] = [
  today,
  training,
  { id: LOG_SECTION_ID, label: "Log", icon: "log", pages: [] },
  nutrition,
  {
    id: "more",
    label: "More",
    icon: "more",
    pages: [...body.pages, ...DESKTOP_FOOTER_SECTIONS.flatMap((section) => section.pages)],
  },
];

function matchLength(destination: NavDestination, pathname: string): number {
  return Math.max(0, ...[destination.path, ...(destination.aliases ?? [])]
    .filter((path) => pathname === path || pathname.startsWith(`${path}/`))
    .map((path) => path.length));
}

export function destinationForPath<T extends NavDestination>(
  destinations: readonly T[],
  pathname: string,
): T | null {
  let best: T | null = null;
  let longest = 0;
  for (const destination of destinations) {
    const length = matchLength(destination, pathname);
    if (length > longest) {
      best = destination;
      longest = length;
    }
  }
  return best;
}

/** Find the visible tab for an existing URL, including its deeper destinations. */
export function pageForPath(sections: NavSection[], pathname: string): NavPage | null {
  const pages = sections.flatMap((section) => section.pages);
  const matches = pages.map((page) => ({
    ...page,
    aliases: [...(page.aliases ?? []), ...(page.children ?? []).flatMap(
      (child) => [child.path, ...(child.aliases ?? [])],
    )],
    page,
  }));
  return destinationForPath(matches, pathname)?.page ?? null;
}

export function sectionForPath(sections: NavSection[], pathname: string): NavSection | null {
  const page = pageForPath(sections, pathname);
  return sections.find((section) => page && section.pages.includes(page)) ?? null;
}
