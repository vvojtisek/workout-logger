// Reaches an app page through the real navigation, whichever shell the
// viewport gets: the desktop rail (>= 1024px) or the mobile bottom tabs. A
// section that groups several pages shows them as sub-tabs. On a phone the
// middle tab is the Log button, which opens a sheet of entries instead.

/** @type {Record<string, [section: string, tab?: string, destination?: string]>} */
const DESTINATIONS = {
  Today: ["Today"],
  Training: ["Training"],
  "Training trends": ["Training", "Trends"],
  Plans: ["Training", "Planning", "Plans"],
  Programs: ["Training", "Planning", "Programs"],
  Calendar: ["Training", "Planning"],
  "Sport schedule": ["Training", "Planning", "Sport schedule"],
  History: ["Training", "Entries"],
  "Training load": ["Training", "Trends", "Training load"],
  Exercises: ["Training", "Library"],
  Locations: ["Training", "Library", "Locations"],
  Nutrition: ["Nutrition"],
  "Nutrition trends": ["Nutrition", "Trends"],
  "Meal Log": ["Nutrition", "Entries"],
  Foods: ["Nutrition", "Food & plans"],
  "Nutrition plans": ["Nutrition", "Food & plans", "Nutrition plans"],
  "Kitchen & Store": ["Nutrition", "Food & plans", "Kitchen & Store"],
};

/** Pages opened from the shared Log menu. */
const LOG_ENTRIES = {
  "New Workout": "Past workout",
  "Log Activity": "Activity",
  Cardio: "Cardio",
  Recovery: "Recovery",
};

/** @param {import("@playwright/test").Page} page */
export function isDesktop(page) {
  return (page.viewportSize()?.width ?? 1280) >= 1024;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} label the page's own name, such as "Sleep" or "Programs"
 */
export async function openPage(page, label) {
  const logEntry = LOG_ENTRIES[/** @type {keyof typeof LOG_ENTRIES} */ (label)];
  if (logEntry) {
    await openLogSheet(page);
    await page.getByRole("dialog", { name: "Log" })
      .getByRole("link", { name: logEntry, exact: true })
      .click();
    return;
  }
  const desktop = isDesktop(page);
  const extra = desktop ? {
    Biometrics: ["Body Metrics & Sleep", "Biometrics"],
    Sleep: ["Body Metrics & Sleep", "Sleep"],
    Tokens: ["API & MCP Tokens"],
    Settings: ["Settings"],
  } : {
    Biometrics: ["More", "Biometrics"],
    Sleep: ["More", "Sleep"],
    Tokens: ["More", "Tokens"],
    Settings: ["More", "Settings"],
  };
  const entry = DESTINATIONS[label] ?? extra[/** @type {keyof typeof extra} */ (label)];
  if (!entry) throw new Error(`No navigation entry leads to ${label}`);
  const [section, tab, destination] = entry;
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: section, exact: true })
    .click();
  if (tab) {
    await page.getByRole("navigation", { name: "Section pages" })
      .getByRole("link", { name: tab, exact: true })
      .click();
  }
  if (destination) {
    await page.getByRole("navigation", { name: "Section destinations" })
      .getByRole("link", { name: destination, exact: true })
      .click();
  }
}

/**
 * Where a list page shows its detail: the right-hand pane on desktop, the
 * whole page on a phone.
 * @param {import("@playwright/test").Page} page
 */
export function detailPane(page) {
  return isDesktop(page) ? page.getByTestId("detail-pane") : page.locator("body");
}

/**
 * Opens the shared quick-entry menu.
 * @param {import("@playwright/test").Page} page
 */
export async function openLogSheet(page) {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Log", exact: true })
    .click();
}
