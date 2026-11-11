import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";

// Regression for issue #183: on desktop the list stays beside an open detail,
// and closing the detail used to remount the list, wiping the search the user
// had typed. The list must keep the search and still reload its data.
// Desktop only: on a phone the detail replaces the list, so there is no
// visible list whose input could be kept.
test("closing a detail keeps the catalogue search and reloads the filtered list", async ({
  page,
  request,
}) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || `lks-${Date.now()}`}:list-search]`;
  /** @type {string | undefined} */
  let exerciseId;

  try {
    page.setDefaultTimeout(5_000);
    const created = await request.post("/api/v1/exercises", {
      data: { name: `${tag} Split Squat`, aliases: [`${tag} Bulgarian`] },
    });
    expect(created.status()).toBe(201);
    exerciseId = (await created.json()).id;

    await page.goto("/");
    await openPage(page, "Exercises");
    const search = page.getByLabel("Search exercises");
    const items = page.locator("#exercises-list").getByRole("listitem");
    await search.fill(`${tag} Bulgarian`);
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(`${tag} Split Squat`);

    // Open a form beside the list; the list and its search stay visible.
    await page.getByRole("button", { name: "New exercise" }).click();
    await expect(page.getByRole("heading", { name: "New Exercise" })).toBeVisible();
    await expect(search).toHaveValue(`${tag} Bulgarian`);

    // Closing the form makes the list reload. Wait for that reload itself
    // rather than for a fixed time, then check it kept the search.
    const reload = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/v1/exercises",
    );
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/exercises$/);
    const reloaded = await reload;
    expect(new URL(reloaded.url()).searchParams.get("q")).toBe(`${tag} Bulgarian`);

    await expect(search).toHaveValue(`${tag} Bulgarian`);
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(`${tag} Split Squat`);
  } finally {
    if (exerciseId) {
      await request.delete(`/api/v1/exercises/${exerciseId}`);
      expect((await request.get(`/api/v1/exercises/${exerciseId}`)).status()).toBe(404);
    }
  }
});
