// Reaches an app page through the real navigation, whichever shell the
// viewport gets: the desktop rail (>= 1024px) or the mobile bottom tabs. A
// section that groups several pages shows them as sub-tabs.

/** @type {Record<string, string[]>} */
const DESKTOP_SECTIONS = {
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
  Train: ["New Workout", "Log Activity", "Calendar", "Sport schedule", "History"],
  Plans: ["Plans", "Programs", "Exercises", "Locations"],
  Nutrition: ["Nutrition"],
  Body: ["Biometrics", "Sleep"],
  More: ["Settings", "Tokens"],
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
