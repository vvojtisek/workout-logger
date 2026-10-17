// Reaches an app page through the real navigation, whichever shell the
// viewport gets: the desktop rail (>= 1024px) or the mobile bottom tabs. A
// section that groups several pages shows them as sub-tabs. On a phone the
// middle tab is the Log button, which opens a sheet of entries instead.

/** @type {Record<string, string[]>} */
const DESKTOP_SECTIONS = {
  Today: ["Today"],
  "Active Workout": ["New Workout", "Log Activity"],
  "Programs & Plans": ["Plans", "Programs"],
  Calendar: ["Calendar", "Sport schedule"],
  "Workout History": ["History"],
  "Exercise Catalogue": ["Exercises", "Locations"],
  "Nutrition & Meals": ["Nutrition"],
  "Body Metrics & Sleep": ["Biometrics", "Sleep"],
  "API & MCP Tokens": ["Tokens"],
  Settings: ["Settings"],
};

/** @type {Record<string, string[]>} */
const MOBILE_SECTIONS = {
  Today: ["Today"],
  History: ["History", "Calendar"],
  Coach: ["Plans", "Programs", "Exercises", "Locations", "Sport schedule"],
  More: ["Nutrition", "Biometrics", "Sleep", "Settings", "Tokens"],
};

/** Pages behind the phone's Log button, by the sheet entry that opens them. */
const MOBILE_LOG_ENTRIES = {
  "New Workout": "Past workout",
  "Log Activity": "Activity",
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
  const logEntry = isDesktop(page)
    ? undefined
    : MOBILE_LOG_ENTRIES[/** @type {keyof typeof MOBILE_LOG_ENTRIES} */ (label)];
  if (logEntry) {
    await openLogSheet(page);
    await page
      .getByRole("dialog", { name: "Log" })
      .getByRole("link", { name: logEntry, exact: true })
      .click();
    return;
  }
  const sections = isDesktop(page) ? DESKTOP_SECTIONS : MOBILE_SECTIONS;
  const entry = Object.entries(sections).find(([, pages]) =>
    pages.includes(label),
  );
  if (!entry) throw new Error(`No navigation entry leads to ${label}`);
  const [section, pages] = entry;
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: section, exact: true })
    .click();
  if (pages.length > 1) {
    await page
      .getByRole("navigation", { name: "Section pages" })
      .getByRole("link", { name: label, exact: true })
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
 * Opens the phone's quick-entry sheet from the middle tab.
 * @param {import("@playwright/test").Page} page
 */
export async function openLogSheet(page) {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Log", exact: true })
    .click();
}
