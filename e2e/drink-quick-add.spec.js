import { expect, test } from "@playwright/test";

import { clickAndAwaitWrite } from "./support/writes.js";

test("logs a drink in one tap, undoes it, and edits the preset", async ({ page, request }) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `drinks-${Date.now()}`;
  const drink = `[E2E:${TEST_RUN_ID}:drinks] cappuccino`;
  /** @type {string | undefined} */ let presetId;

  /** @returns {Promise<Array<{id: string, items: Array<{food_id: string | null, quantity: number, unit: string, energy_kcal_snapshot: number}>}>>} */
  async function ourEntries() {
    const body = await (await request.get("/api/v1/meal-entries?limit=100")).json();
    return body.items.filter((/** @type {{items: Array<{food_name_snapshot: string}>}} */ entry) =>
      entry.items.some((item) => item.food_name_snapshot === drink),
    );
  }

  /** @returns {Promise<Array<{id: string, name: string, energy_kcal: number}>>} */
  async function presets() {
    return (await (await request.get("/api/v1/quick-add-presets")).json()).items;
  }

  try {
    page.setDefaultTimeout(5_000);
    const created = await request.post("/api/v1/quick-add-presets", {
      data: { name: drink, quantity: 150, unit: "ml", energy_kcal: 90, protein_g: 5, carbohydrate_g: 7.2, fat_g: 4.5, position: 99 },
    });
    expect(created.status()).toBe(201);
    presetId = (await created.json()).id;

    await page.goto("/nutrition/meals/new");
    const bar = page.getByRole("group", { name: "Quick add" });
    // The migration's defaults sit beside the spec's own drink.
    await expect(bar.getByRole("button", { name: "Quick add Cappuccino", exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Quick add Tea", exact: true })).toBeVisible();

    await clickAndAwaitWrite(page, bar.getByRole("button", { name: `Quick add ${drink}` }), "POST");
    const toast = page.getByRole("status").filter({ hasText: `Logged ${drink}` });
    await expect(toast).toBeVisible();
    const logged = await ourEntries();
    expect(logged).toHaveLength(1);
    expect(logged[0].items).toEqual([
      expect.objectContaining({ food_id: null, quantity: 150, unit: "ml", energy_kcal_snapshot: 90 }),
    ]);

    await clickAndAwaitWrite(page, toast.getByRole("button", { name: "Undo" }), "DELETE");
    await expect(page.getByRole("status").filter({ hasText: `Removed ${drink}` })).toBeVisible();
    expect(await ourEntries()).toEqual([]);

    await page.getByRole("link", { name: "Edit drinks" }).click();
    const form = page.getByRole("form", { name: `Drink ${drink}` });
    await form.getByLabel("Energy (kcal)").fill("95");
    await clickAndAwaitWrite(page, form.getByRole("button", { name: "Save" }), "PUT");
    expect((await presets()).find((preset) => preset.id === presetId)?.energy_kcal).toBe(95);
  } finally {
    for (const entry of await ourEntries()) {
      await request.delete(`/api/v1/meal-entries/${entry.id}`);
    }
    if (presetId) await request.delete(`/api/v1/quick-add-presets/${presetId}`);
    expect(await ourEntries()).toEqual([]);
    expect((await presets()).some((preset) => preset.name === drink)).toBe(false);
  }
});
