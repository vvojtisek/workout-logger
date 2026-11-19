import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

test("the app shell fits the viewport and reaches every page", async ({
  page,
}) => {
  page.setDefaultTimeout(5_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/today$/);
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  if (isDesktop(page)) {
    // Rail of named destinations, full-width workspace beside it.
    for (const label of [
      "Today",
      "Training",
      "Nutrition",
      "Body Metrics & Sleep",
      "API & MCP Tokens",
      "Settings",
    ]) {
      await expect(
        nav.getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    }
    const rail = await page.locator("aside").filter({ has: nav }).boundingBox();
    expect(rail?.width).toBe(220);
    await expect(
      nav.getByRole("link", { name: "Today", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const main = await page.getByRole("main").boundingBox();
    expect(main?.x).toBe(220);
    expect(main?.width).toBe(1280 - 220);
  } else {
    // Four thumb-sized tabs around a central Log button at the bottom, a
    // compact bar at the top.
    const tabs = nav.getByRole("link");
    await expect(tabs).toHaveText(
      ["Today", "Training", "Nutrition", "More"].map((t) => new RegExp(t)),
    );
    await expect(nav.getByRole("button", { name: "Log", exact: true })).toBeVisible();
    const bar = await nav.boundingBox();
    const viewport = page.viewportSize();
    expect(bar?.height).toBe(60);
    expect((bar?.y ?? 0) + (bar?.height ?? 0)).toBe(viewport?.height);
    const header = await page.locator("header").boundingBox();
    expect(header?.height).toBe(48);
    await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }

  await nav.getByRole("button", { name: "Log", exact: true }).click();
  const log = page.getByRole("dialog", { name: "Log" });
  await expect(log.getByRole("link").first()).toHaveText(/Start a workout/);
  await expect(log.getByRole("link", { name: "Food", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(log).toBeHidden();

  // Nothing spills sideways.
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  // Every page is reachable through the navigation.
  /** @type {[string, RegExp][]} */
  const destinations = [
    ["Today", /\/today$/],
    ["Training", /\/training$/],
    ["Training trends", /\/training\/trends$/],
    ["New Workout", /\/log\/new$/],
    ["Log Activity", /\/activity\/new$/],
    ["Cardio", /\/activity\/quick$/],
    ["Recovery", /\/recovery$/],
    ["Plans", /\/plans$/],
    ["Programs", /\/programs$/],
    ["Calendar", /\/calendar$/],
    ["Sport schedule", /\/schedule$/],
    ["History", /\/history$/],
    ["Training load", /\/training-load$/],
    ["Exercises", /\/exercises$/],
    ["Locations", /\/locations$/],
    ["Nutrition", /\/nutrition$/],
    ["Biometrics", /\/biometrics$/],
    ["Sleep", /\/sleep$/],
    ["Tokens", /\/tokens$/],
    ["Settings", /\/settings$/],
  ];
  for (const [label, url] of destinations) {
    await openPage(page, label);
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  }

  // A grouped section marks the page it is on.
  await openPage(page, "Sleep");
  await expect(
    page
      .getByRole("navigation", { name: "Section pages" })
      .getByRole("link", { name: "Sleep" }),
  ).toHaveAttribute("aria-current", "page");
});

test("the rail flips the theme in one click on desktop", async ({ page }) => {
  test.skip(
    !isDesktop(page),
    "The quick theme toggle lives in the desktop rail",
  );
  page.setDefaultTimeout(5_000);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
});
