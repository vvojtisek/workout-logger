import { expect, test } from "@playwright/test";

test("the header badge names the build the server reports", async ({ page, request }) => {
  page.setDefaultTimeout(5_000);
  await page.addInitScript((key) => {
    localStorage.setItem("workout_logger_api_key", key);
  }, process.env.E2E_API_KEY || "");

  const health = await request.get("/health");
  expect(health.status()).toBe(200);
  /** @type {{version: string, commit: string}} */
  const build = await health.json();

  await page.goto("/");
  const badge = page.locator("#connection-status");
  const version = page.locator("#build-version");
  await expect(version).toBeVisible();

  const kind = await version.getAttribute("data-build-kind");
  if (kind === "unknown") {
    await expect(version).toHaveText(" · version unknown");
  } else {
    // The badge shows the server's own version, never a frontend constant.
    await expect(version).toContainText(build.version.replace(/^v/, ""));
  }
  if (kind === "release" && /^[0-9a-f]{40}$/i.test(build.commit)) {
    await expect(version).toContainText(build.commit.slice(0, 7));
  }
  await expect(badge).toHaveAttribute("aria-label", /^Online\. /);
});
