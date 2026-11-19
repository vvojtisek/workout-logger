import { expect, test } from "@playwright/test";

import { isDesktop } from "./support/navigation.js";

test("the phone's Today leads with the workout and shows trends after the daily summaries", async ({
  page,
}) => {
  test.skip(isDesktop(page), "Today is the phone's home screen");
  page.setDefaultTimeout(5_000);
  await page.goto("/today");

  const coach = page.getByTestId("today-coach");
  const sleep = page.getByTestId("today-sleep");
  const food = page.getByTestId("today-food");
  const glance = page.getByLabel("At a glance");
  await expect(coach).toBeVisible();
  await expect(sleep).toBeVisible();

  const y = async (/** @type {import("@playwright/test").Locator} */ locator) =>
    (await locator.boundingBox())?.y ?? Number.NaN;
  // Order: workout, quick logs, then summaries.
  expect(await y(coach)).toBeLessThan(await y(sleep));
  expect(await y(sleep)).toBeLessThan(await y(food));
  expect(await y(food)).toBeLessThan(await y(glance));

  const trends = page.getByRole("complementary", { name: "Training analysis" });
  await expect(trends.getByTestId("volume-chart")).toBeVisible();
  expect(await y(glance)).toBeLessThan(await y(trends));
  await expect(trends.getByRole("link", { name: "See training trends" }))
    .toHaveAttribute("href", "/training/trends");

  // The workout action is on the first screen: no scrolling to start.
  const coachBox = await coach.boundingBox();
  expect((coachBox?.y ?? 0) + (coachBox?.height ?? 0)).toBeLessThan(
    page.viewportSize()?.height ?? 0,
  );

  // No bordered box around each block, and none nested in another.
  expect(await page.locator("#today-view .card").count()).toBe(0);
});
