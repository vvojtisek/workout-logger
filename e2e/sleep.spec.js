import { expect, test } from "@playwright/test";
import { detailPane, openPage } from "./support/navigation.js";
import { clickAndAwaitWrite } from "./support/writes.js";

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
    await openPage(page, "Sleep");
    await expect(page.getByRole("heading", { name: "Sleep", exact: true })).toBeVisible();

    // Log a sleep entry entirely through the GUI.
    await page.getByRole("button", { name: "Log sleep" }).click();
    await expect(page.getByRole("heading", { name: "Log Sleep" })).toBeVisible();
    const bedDate = page.getByLabel("Bedtime date");
    const bedTime = page.getByRole("textbox", { name: "Bedtime time", exact: true });
    const wakeDate = page.getByLabel("Wake date");
    const wakeTime = page.getByRole("textbox", { name: "Wake time", exact: true });
    const details = page.getByRole("button", { name: "Sleep details" });
    await expect(bedDate).toHaveAttribute("type", "date");
    await expect(wakeTime).toHaveAttribute("inputmode", "numeric");
    await expect(bedTime).toHaveValue("23:00");
    await expect(wakeTime).toHaveValue("07:00");
    await expect(page.getByLabel("Notes (optional)")).toBeHidden();
    await expect(detailPane(page).getByRole("button", { name: "Log sleep" })).toBeInViewport();
    await bedDate.fill("2032-04-10");
    await bedTime.fill("23:15");
    await wakeDate.fill("2032-04-11");
    await wakeTime.fill("07:15");
    await expect(page.getByText("8 h 00 min", { exact: true })).toBeVisible();
    for (const label of ["1 · Very poor", "2 · Poor", "3 · Fair", "4 · Good", "5 · Excellent"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "4 · Good", exact: true }).click();
    await details.click();
    await page.getByLabel("Timezone", { exact: true }).fill("America/New_York");
    await page.getByLabel("Estimated sleep (min)").fill("440");
    await page.getByLabel("Time awake (min)").fill("20");
    await page.getByLabel("Resting heart rate (bpm)").fill("58");
    await page.getByLabel("Notes (optional)").fill(`${tag} slept well`);
    await clickAndAwaitWrite(
      page,
      detailPane(page).getByRole("button", { name: "Log sleep", exact: true }),
      "POST",
    );
    await expect(page.getByRole("heading", { name: "Sleep", exact: true })).toBeVisible();

    const list = await request.get("/api/v1/sleep-entries?limit=100");
    /** @type {{items: Array<{id: string, notes: string | null, time_in_bed_seconds: number, sleep_date: string}>}} */
    const listBody = await list.json();
    const created = listBody.items.find((entry) => entry.notes === `${tag} slept well`);
    expect(created).toBeTruthy();
    entryId = created?.id;
    expect(created).toMatchObject({ time_in_bed_seconds: 28_800, awake_seconds: 1200, estimated_sleep_seconds: 26400, resting_heart_rate: 58 });

    // The trend card and history list reflect the logged entry.
    await expect(page.getByText("8h 0m").first()).toBeVisible();
    await expect(page.getByText(/Quality 4\/5 \(Good\)/)).toBeVisible();
    await expect(page.getByText(/2032-04-10/).first()).toBeVisible();
    await expect(page.getByText(/2032-04-10 23:15/)).toBeVisible();

    const trends = await request.get("/api/v1/sleep-entries/trends");
    expect(trends.status()).toBe(200);
    expect((await trends.json()).latest.id).toBe(entryId);

    await page.getByRole("button", { name: "Log sleep" }).click();
    await expect(bedTime).toHaveValue("23:15");
    await expect(wakeTime).toHaveValue("07:15");
    await expect(wakeDate).not.toHaveValue("2032-04-11");
    await details.click();
    await expect(page.getByLabel("Resting heart rate (bpm)")).toHaveValue("58");
    await expect(page.getByRole("checkbox", { name: "Include Resting heart rate" })).not.toBeChecked();
    await expect(page.getByLabel("Notes (optional)")).toHaveValue("");
    await page.getByRole("button", { name: "Increase Resting heart rate" }).click();
    await expect(page.getByLabel("Resting heart rate (bpm)")).toHaveValue("59");
    await expect(page.getByRole("checkbox", { name: "Include Resting heart rate" })).toBeChecked();
    await page.getByLabel("Notes (optional)").fill(`${tag} minimal`);
    await clickAndAwaitWrite(page, detailPane(page).getByRole("button", { name: "Log sleep", exact: true }), "POST");
    const minimalList = await request.get("/api/v1/sleep-entries?limit=100");
    const minimal = (await minimalList.json()).items.find(
      /** @param {{notes: string | null}} row */ (row) => row.notes === `${tag} minimal`
    );
    expect(minimal).toMatchObject({ quality_score: null, awake_seconds: null, estimated_sleep_seconds: null, resting_heart_rate: 59 });
    expect((await request.delete(`/api/v1/sleep-entries/${minimal.id}`)).status()).toBe(204);
    expect((await request.get(`/api/v1/sleep-entries/${minimal.id}`)).status()).toBe(404);

    // Edit through the GUI: extend the sleep end by one hour.
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} slept well` })
      .getByRole("button", { name: "Edit" })
      .click();
    await expect(page.getByRole("heading", { name: "Edit Sleep Entry" })).toBeVisible();
    await expect(bedDate).toHaveValue("2032-04-10");
    await wakeTime.fill("08:15");
    await clickAndAwaitWrite(page, page.getByRole("button", { name: "Save changes" }), "PUT");
    await expect(page.getByRole("heading", { name: "Sleep", exact: true })).toBeVisible();

    const afterEdit = await request.get(`/api/v1/sleep-entries/${entryId}`);
    expect(await afterEdit.json()).toMatchObject({ time_in_bed_seconds: 32_400, resting_heart_rate: 58, quality_score: 4 });

    // Delete through the GUI and prove it is gone.
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} slept well` })
      .getByRole("button", { name: "Delete" })
      .click();
    await clickAndAwaitWrite(
      page,
      page.getByRole("dialog", { name: "Delete sleep entry" }).getByRole("button", { name: "Delete" }),
      "DELETE",
    );
    await expect(page.locator("#sleep-entries-list").getByText(tag, { exact: false })).toBeHidden();

    const afterDelete = await request.get(`/api/v1/sleep-entries/${entryId}`);
    expect(afterDelete.status()).toBe(404);
    entryId = undefined;
  } finally {
    const remaining = await request.get("/api/v1/sleep-entries?limit=100");
    for (const row of (await remaining.json()).items) {
      if (row.notes?.startsWith(tag)) {
        const url = `/api/v1/sleep-entries/${row.id}`;
        expect((await request.delete(url)).status()).toBe(204);
        expect((await request.get(url)).status()).toBe(404);
      }
    }
  }
});
