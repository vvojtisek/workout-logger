import { expect, test } from "@playwright/test";

// The service worker registers on page load and takes over fetches for
// `/static/`, racing unpredictably with Playwright's own route interception
// below. Disabling it keeps this test about the client-side error boundary,
// not service-worker timing -- the SW's own fetch failures surface through
// the exact same dynamic-import rejection either way, so this doesn't
// change what's being verified.
test.use({ serviceWorkers: "block" });

// Simulates the real production failure mode: a browser tab holds a route
// definition pointing at a chunk filename that no longer exists on the
// server (as happens after a deploy, since the build deletes the previous
// one's hashed files). The first request for that chunk is aborted here to
// stand in for the 404 a stale build would get; the retried request after
// the automatic reload is let through, standing in for the current deploy's
// (different, valid) chunk actually being available.
test("recovers automatically from a stale chunk reference by reloading once", async ({
  page,
}) => {
  page.setDefaultTimeout(10_000);
  await page.addInitScript((key) => {
    localStorage.setItem("workout_logger_api_key", key);
  }, process.env.E2E_API_KEY || "");

  let firstRequestBlocked = false;
  await page.route("**/static/dist/assets/HistoryView-*.js", async (route) => {
    if (!firstRequestBlocked) {
      firstRequestBlocked = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "History" }).click();

  // The failed dynamic import triggers one automatic reload; the retried
  // request is allowed through, landing on a working History page instead
  // of the default "Unexpected Application Error!" screen.
  await expect(page.getByRole("heading", { name: "Workout History" })).toBeVisible();
  expect(firstRequestBlocked).toBe(true);
});
