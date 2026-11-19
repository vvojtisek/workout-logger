import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { detailPane, openPage } from "./support/navigation.js";
import { clickAndAwaitWrite } from "./support/writes.js";

test.use({ timezoneId: "Europe/Prague" });

test("logs, views trends for, edits, and deletes real biometrics entries through the GUI", async ({
  page,
  request,
}) => {
  page.setDefaultTimeout(5_000);
  // Manual entries have no notes or external ID. Tag their local timestamp
  // with the run so cleanup can find a saved row even after an assertion fails.
  const runId = process.env.TEST_RUN_ID ?? randomUUID();
  const tag = createHash("sha256")
    .update(runId + test.info().project.name)
    .digest();
  const year = 2031 + (tag.readUInt16BE(0) % 100);
  const timeTag = [(tag[2] % 23) + 1, tag[3] % 60].map((n) => String(n).padStart(2, "0")).join(":");
  const firstDate = `${year}-02-01`;
  const secondDate = `${year}-02-08`;
  const firstInstant = Date.parse(`${firstDate}T${timeTag}:00+01:00`);
  const secondInstant = Date.parse(`${secondDate}T${timeTag}:00+01:00`);

  let firstId;
  let secondId;

  try {
    await page.goto("/");
    await openPage(page, "Biometrics");
    await expect(page.getByRole("heading", { name: "Biometrics", exact: true })).toBeVisible();

    // First entry, entirely through the GUI.
    await page.getByRole("button", { name: "Log entry" }).click();
    await expect(page.getByRole("heading", { name: "Log Biometrics" })).toBeVisible();
    const date = page.getByLabel("Date", { exact: true });
    const time = page.getByLabel("Time", { exact: true });
    const additional = page.getByRole("button", { name: /Other measurements/ });
    await expect(date).toHaveAttribute("type", "date");
    await expect(time).toHaveAttribute("inputmode", "numeric");
    await expect(date).toHaveValue(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
    await expect(time).toHaveValue(/^[0-9]{2}:[0-9]{2}$/);
    await expect(page.getByLabel("Chest (cm)", { exact: true })).toBeHidden();
    await expect(detailPane(page).getByRole("button", { name: "Log entry" })).toBeInViewport();
    await date.fill(firstDate);
    await time.fill(timeTag);
    await page.getByLabel("Weight (kg)").fill("80.0");
    await page.getByLabel("Body fat (%)").fill("20.0");
    await page.getByLabel("Waist (cm)").fill("88");
    await additional.click();
    await page.getByLabel("Chest (cm)", { exact: true }).fill("96.5");
    await clickAndAwaitWrite(
      page,
      detailPane(page).getByRole("button", { name: "Log entry" }),
      "POST",
    );
    await expect(page.getByRole("heading", { name: "Biometrics", exact: true })).toBeVisible();

    const listAfterFirst = await request.get("/api/v1/body-metrics?limit=100");
    /** @type {{items: Array<{id: string, measured_at: string, weight_kg: number}>}} */
    const listAfterFirstBody = await listAfterFirst.json();
    const first = listAfterFirstBody.items.find(
      (item) => new Date(item.measured_at).getTime() === firstInstant,
    );
    expect(first).toMatchObject({ weight_kg: 80, chest_cm: 96.5 });
    firstId = first?.id;

    // Verify it renders in the trend card and history list.
    await expect(page.getByText("80.0 kg", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`${firstDate} ${timeTag}`, { exact: false })).toBeVisible();
    await expect(page.getByText("20.0% BF")).toBeVisible();

    // Second entry, exactly 7 days later with a lower weight.
    await page.getByRole("button", { name: "Log entry" }).click();
    await date.fill(secondDate);
    await time.fill(timeTag);
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("80");
    await expect(page.getByLabel("Waist (cm)")).toHaveValue("88");
    await expect(page.getByLabel("Body fat (%)")).toHaveValue("20");
    await page.getByRole("checkbox", { name: "Include Body fat" }).uncheck();
    await page.getByRole("button", { name: "Decrease Weight" }).click();
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("79.9");
    await page.getByRole("slider", { name: "Adjust Waist" }).press("ArrowRight");
    await additional.click();
    await expect(page.getByLabel("Chest (cm)", { exact: true })).toHaveValue("96.5");
    await page.getByLabel("Weight (kg)").fill("79.0");
    await clickAndAwaitWrite(
      page,
      detailPane(page).getByRole("button", { name: "Log entry" }),
      "POST",
    );
    await expect(page.getByRole("heading", { name: "Biometrics", exact: true })).toBeVisible();

    const listAfterSecond = await request.get("/api/v1/body-metrics?limit=100");
    /** @type {{items: Array<{id: string, measured_at: string, weight_kg: number}>}} */
    const listAfterSecondBody = await listAfterSecond.json();
    const second = listAfterSecondBody.items.find(
      (item) => new Date(item.measured_at).getTime() === secondInstant,
    );
    expect(second).toMatchObject({
      weight_kg: 79,
      body_fat_percent: null,
      waist_cm: 88.1,
      chest_cm: null,
    });
    secondId = second?.id;

    const trends = await request.get("/api/v1/body-metrics/trends");
    expect(trends.status()).toBe(200);
    const trendsBody = await trends.json();
    expect(trendsBody.latest.weight_kg).toBe(79);
    expect(trendsBody.weight_kg_delta_7d).toBe(-1);

    // The trend card reflects the new latest weight and delta.
    await expect(page.getByText("79.0 kg", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("-1.0 kg")).toBeVisible();

    // Both skipped values still have their own latest reading.
    await page.getByRole("button", { name: "Log entry" }).click();
    await expect(page.getByLabel("Body fat (%)")).toHaveValue("20");
    await additional.click();
    await expect(page.getByLabel("Chest (cm)", { exact: true })).toHaveValue("96.5");
    await page.getByRole("button", { name: "Cancel" }).click();

    // Edit the first entry through the GUI.
    const firstRow = page.getByRole("listitem").filter({ hasText: "20.0% BF" });
    await firstRow.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit Entry" })).toBeVisible();
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("80");
    await expect(date).toHaveValue(firstDate);
    await expect(time).toHaveValue(timeTag);
    await additional.click();
    await expect(page.getByRole("checkbox", { name: "Include Chest" })).toBeChecked();
    await page.getByRole("button", { name: "Increase Chest" }).click();
    await additional.click();
    await page.getByLabel("Weight (kg)").fill("81.5");
    await clickAndAwaitWrite(page, page.getByRole("button", { name: "Save changes" }), "PUT");
    await expect(page.getByRole("heading", { name: "Biometrics", exact: true })).toBeVisible();

    const afterEdit = await request.get(`/api/v1/body-metrics/${firstId}`);
    expect(await afterEdit.json()).toMatchObject({ weight_kg: 81.5, chest_cm: 96.6, waist_cm: 88 });

    // Delete both entries through the GUI and prove they are gone.
    await page
      .getByRole("listitem")
      .filter({ hasText: "20.0% BF" })
      .getByRole("button", { name: "Delete" })
      .click();
    await clickAndAwaitWrite(
      page,
      page.getByRole("dialog", { name: "Delete entry" }).getByRole("button", { name: "Delete" }),
      "DELETE",
    );
    await expect(page.getByText("20.0% BF")).toBeHidden();

    const afterFirstDelete = await request.get(`/api/v1/body-metrics/${firstId}`);
    expect(afterFirstDelete.status()).toBe(404);
    firstId = undefined;

    await page
      .getByRole("listitem")
      .filter({ hasText: "79.0 kg" })
      .getByRole("button", { name: "Delete" })
      .click();
    await clickAndAwaitWrite(
      page,
      page.getByRole("dialog", { name: "Delete entry" }).getByRole("button", { name: "Delete" }),
      "DELETE",
    );
    await expect(page.getByRole("listitem").filter({ hasText: "79.0 kg" })).toBeHidden();

    const afterSecondDelete = await request.get(`/api/v1/body-metrics/${secondId}`);
    expect(afterSecondDelete.status()).toBe(404);
    secondId = undefined;
  } finally {
    const remaining = await request.get("/api/v1/body-metrics?limit=100");
    expect(remaining.ok()).toBe(true);
    for (const row of (await remaining.json()).items) {
      if ([firstInstant, secondInstant].includes(Date.parse(row.measured_at))) {
        const url = `/api/v1/body-metrics/${row.id}`;
        expect((await request.delete(url)).ok()).toBe(true);
        expect((await request.get(url)).status()).toBe(404);
      }
    }
  }
});
