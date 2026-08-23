import { expect, test } from "@playwright/test";

test("logs, views trends for, edits, and deletes a real sleep entry through the GUI", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `sleep-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:sleep]`;

  let entryId;

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");

    await page.goto("/");
    await page.getByRole("button", { name: "Sleep" }).click();
    await expect(page.getByRole("heading", { name: "Sleep" })).toBeVisible();

    // Log a sleep entry entirely through the GUI.
    await page.getByRole("button", { name: "Log sleep" }).click();
    await expect(page.getByRole("heading", { name: "Log Sleep" })).toBeVisible();
    await page.getByLabel("Went to bed").fill("2032-04-10T23:00");
    await page.getByLabel("Woke up").fill("2032-04-11T07:00");
    await page.getByLabel("Timezone").fill("America/New_York");
    await page.getByLabel("Estimated sleep (minutes, optional)").fill("440");
    await page.getByLabel("Time awake (minutes, optional)").fill("20");
    await page.getByLabel("Quality (1–5, optional)").fill("4");
    await page.getByLabel("Resting heart rate (bpm, optional)").fill("58");
    await page.getByLabel("Notes (optional)").fill(`${tag} slept well`);
    await page.getByRole("button", { name: "Log sleep", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sleep" })).toBeVisible();

    const list = await request.get("/api/v1/sleep-entries?limit=100");
    /** @type {{items: Array<{id: string, notes: string | null, time_in_bed_seconds: number, sleep_date: string}>}} */
    const listBody = await list.json();
    const created = listBody.items.find((entry) => entry.notes === `${tag} slept well`);
    expect(created).toBeTruthy();
    entryId = created?.id;
    expect(created).toMatchObject({ time_in_bed_seconds: 28_800 });

    // The trend card and history list reflect the logged entry.
    await expect(page.getByText("8h 0m").first()).toBeVisible();
    await expect(page.getByText(/Quality 4\/5/)).toBeVisible();

    const trends = await request.get("/api/v1/sleep-entries/trends");
    expect(trends.status()).toBe(200);
    expect((await trends.json()).latest.id).toBe(entryId);

    // Edit through the GUI: extend the sleep end by one hour.
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag}` })
      .getByRole("button", { name: "Edit" })
      .click();
    await expect(page.getByRole("heading", { name: "Edit Sleep Entry" })).toBeVisible();
    await expect(page.getByLabel("Went to bed")).toHaveValue("2032-04-10T23:00");
    await page.getByLabel("Woke up").fill("2032-04-11T08:00");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Sleep" })).toBeVisible();

    const afterEdit = await request.get(`/api/v1/sleep-entries/${entryId}`);
    expect((await afterEdit.json()).time_in_bed_seconds).toBe(32_400);

    // Delete through the GUI and prove it is gone.
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag}` })
      .getByRole("button", { name: "Delete" })
      .click();
    await page
      .getByRole("dialog", { name: "Delete sleep entry" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.locator("#sleep-entries-list").getByText(tag, { exact: false })).toBeHidden();

    const afterDelete = await request.get(`/api/v1/sleep-entries/${entryId}`);
    expect(afterDelete.status()).toBe(404);
    entryId = undefined;
  } finally {
    if (entryId) {
      await request.delete(`/api/v1/sleep-entries/${entryId}`);
    }
  }
});
