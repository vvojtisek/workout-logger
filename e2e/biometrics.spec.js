import { expect, test } from "@playwright/test";

test("logs, views trends for, edits, and deletes real biometrics entries through the GUI", async ({
  page,
  request,
}) => {
  page.setDefaultTimeout(5_000);
  await page.addInitScript((key) => {
    localStorage.setItem("workout_logger_api_key", key);
  }, process.env.E2E_API_KEY || "");

  let firstId;
  let secondId;

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Biometrics" }).click();
    await expect(page.getByRole("heading", { name: "Biometrics" })).toBeVisible();

    // First entry, entirely through the GUI.
    await page.getByRole("button", { name: "Log entry" }).click();
    await expect(page.getByRole("heading", { name: "Log Biometrics" })).toBeVisible();
    await page.getByLabel("Date and time").fill("2031-02-01T08:00");
    await page.getByLabel("Weight (kg)").fill("80.0");
    await page.getByLabel("Body fat (%, optional)").fill("20.0");
    await page.getByLabel("Waist (cm)").fill("88");
    await page.getByRole("button", { name: "Log entry" }).click();
    await expect(page.getByRole("heading", { name: "Biometrics" })).toBeVisible();

    const listAfterFirst = await request.get("/api/v1/body-metrics?limit=100");
    /** @type {{items: Array<{id: string, measured_at: string, weight_kg: number}>}} */
    const listAfterFirstBody = await listAfterFirst.json();
    const first = listAfterFirstBody.items.find(
      (item) => item.measured_at === "2031-02-01T08:00:00Z",
    );
    expect(first).toMatchObject({ weight_kg: 80 });
    firstId = first?.id;

    // Verify it renders in the trend card and history list.
    await expect(page.getByText("80.0 kg", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("20.0% BF")).toBeVisible();

    // Second entry, exactly 7 days later with a lower weight.
    await page.getByRole("button", { name: "Log entry" }).click();
    await page.getByLabel("Date and time").fill("2031-02-08T08:00");
    await page.getByLabel("Weight (kg)").fill("79.0");
    await page.getByRole("button", { name: "Log entry" }).click();
    await expect(page.getByRole("heading", { name: "Biometrics" })).toBeVisible();

    const listAfterSecond = await request.get("/api/v1/body-metrics?limit=100");
    /** @type {{items: Array<{id: string, measured_at: string, weight_kg: number}>}} */
    const listAfterSecondBody = await listAfterSecond.json();
    const second = listAfterSecondBody.items.find(
      (item) => item.measured_at === "2031-02-08T08:00:00Z",
    );
    expect(second).toMatchObject({ weight_kg: 79 });
    secondId = second?.id;

    const trends = await request.get("/api/v1/body-metrics/trends");
    expect(trends.status()).toBe(200);
    const trendsBody = await trends.json();
    expect(trendsBody.latest.weight_kg).toBe(79);
    expect(trendsBody.weight_kg_delta_7d).toBe(-1);

    // The trend card reflects the new latest weight and delta.
    await expect(page.getByText("79.0 kg", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("-1.0 kg")).toBeVisible();

    // Edit the first entry through the GUI.
    const firstRow = page.getByRole("listitem").filter({ hasText: "20.0% BF" });
    await firstRow.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit Entry" })).toBeVisible();
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("80");
    await page.getByLabel("Weight (kg)").fill("81.5");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Biometrics" })).toBeVisible();

    const afterEdit = await request.get(`/api/v1/body-metrics/${firstId}`);
    expect((await afterEdit.json()).weight_kg).toBe(81.5);

    // Delete both entries through the GUI and prove they are gone.
    await page
      .getByRole("listitem")
      .filter({ hasText: "20.0% BF" })
      .getByRole("button", { name: "Delete" })
      .click();
    await page.getByRole("dialog", { name: "Delete entry" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("20.0% BF")).toBeHidden();

    const afterFirstDelete = await request.get(`/api/v1/body-metrics/${firstId}`);
    expect(afterFirstDelete.status()).toBe(404);
    firstId = undefined;

    await page
      .getByRole("listitem")
      .filter({ hasText: "79.0 kg" })
      .getByRole("button", { name: "Delete" })
      .click();
    await page.getByRole("dialog", { name: "Delete entry" }).getByRole("button", { name: "Delete" }).click();

    const afterSecondDelete = await request.get(`/api/v1/body-metrics/${secondId}`);
    expect(afterSecondDelete.status()).toBe(404);
    secondId = undefined;
  } finally {
    if (firstId) await request.delete(`/api/v1/body-metrics/${firstId}`);
    if (secondId) await request.delete(`/api/v1/body-metrics/${secondId}`);
  }
});
