import { expect, test } from "@playwright/test";
import { detailPane, openPage } from "./support/navigation.js";
import { clickAndAwaitWrite } from "./support/writes.js";

// "Chléb žitný" is in the seed; "Vločky žitné" (ndb-0615) is only in the
// fallback catalogue, so the test adds it from there.
const CATALOG_ID = "ndb-0615";
const CATALOG_NAME = "Vločky žitné";

test("logs a seeded food and adds a missing one from the fallback catalogue", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `food-catalog-${Date.now()}`;
  const note = `[E2E:${TEST_RUN_ID}:food-catalog]`;

  /** @type {string | undefined} */
  let entryId;
  /** @type {string | undefined} */
  let addedFoodId;

  try {
    page.setDefaultTimeout(5_000);

    // The seed is in the database; the catalogue is not.
    /** @type {{items: Array<{id: string, name: string, catalog_id: string | null}>}} */
    const seeded = await (await request.get("/api/v1/foods?limit=100&q=Chl%C3%A9b%20%C5%BEitn%C3%BD")).json();
    expect(seeded.items.map((food) => food.catalog_id)).toContain("bread-rye");
    /** @type {{items: Array<{catalog_id: string | null}>}} */
    const before = await (await request.get("/api/v1/foods?limit=100")).json();
    expect(before.items.some((food) => food.catalog_id === CATALOG_ID)).toBe(false);

    await page.goto("/");
    await openPage(page, "Nutrition");
    await page.goto("/nutrition/meals");
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByRole("heading", { name: "Log Meal" })).toBeVisible();
    await page.getByLabel("Notes (optional)").fill(note);

    // Item 1: a seeded food straight from the picker.
    await page.getByLabel("Food", { exact: true }).selectOption({ label: "Chléb žitný (100 g)" });
    await page.getByLabel(/^Quantity \(g\)$/).fill("60");

    // Item 2: missing from the picker, so search the catalogue and add it.
    await page.getByRole("button", { name: "+ Add item" }).click();
    const secondItem = page.locator(".meal-item-row").nth(1);
    await expect(secondItem.getByLabel("Food", { exact: true }).locator("option", { hasText: CATALOG_NAME })).toHaveCount(0);
    await secondItem.getByRole("button", { name: "Not in the list? Search the catalogue" }).click();
    await secondItem.getByLabel("Search the full food catalogue").fill("vlocky zitne");
    await clickAndAwaitWrite(
      page,
      secondItem.getByRole("button", { name: `Add ${CATALOG_NAME}` }),
      "POST",
    );
    await expect(secondItem.getByLabel("Food", { exact: true })).toHaveValue(/.+/);
    await expect(secondItem.getByLabel("Food", { exact: true }).locator("option:checked")).toHaveText(
      `${CATALOG_NAME} (100 g)`,
    );
    await secondItem.getByLabel(/^Quantity \(g\)$/).fill("40");

    await clickAndAwaitWrite(
      page,
      detailPane(page).getByRole("button", { name: "Log meal", exact: true }),
      "POST",
    );
    await expect(page.getByRole("heading", { name: "Meal Log" })).toBeVisible();

    /** @type {{items: Array<{id: string, notes: string | null, items: Array<{food_id: string | null, food_name_snapshot: string, energy_kcal_snapshot: number}>}>}} */
    const entries = await (await request.get("/api/v1/meal-entries?limit=100")).json();
    const entry = entries.items.find((candidate) => candidate.notes === note);
    expect(entry).toBeTruthy();
    entryId = entry?.id;
    const byName = Object.fromEntries((entry?.items ?? []).map((item) => [item.food_name_snapshot, item]));
    expect(byName["Chléb žitný"].energy_kcal_snapshot).toBe(129);
    expect(byName[CATALOG_NAME].energy_kcal_snapshot).toBeCloseTo(130.4);
    addedFoodId = byName[CATALOG_NAME].food_id ?? undefined;

    // The catalogue entry is now an ordinary food, and adding it again reuses it.
    /** @type {{id: string, source: string, catalog_id: string}} */
    const added = await (await request.get(`/api/v1/foods/${addedFoodId}`)).json();
    expect(added).toMatchObject({ source: "catalog", catalog_id: CATALOG_ID });
    const again = await request.post(`/api/v1/food-catalog/${CATALOG_ID}/add`);
    expect(again.status()).toBe(200);
    expect((await again.json()).id).toBe(addedFoodId);
  } finally {
    if (entryId) {
      await request.delete(`/api/v1/meal-entries/${entryId}`);
      expect((await request.get(`/api/v1/meal-entries/${entryId}`)).status()).toBe(404);
    }
    if (!addedFoodId) {
      /** @type {{items: Array<{id: string, catalog_id: string | null}>}} */
      const foods = await (await request.get("/api/v1/foods?limit=100")).json();
      addedFoodId = foods.items.find((food) => food.catalog_id === CATALOG_ID)?.id;
    }
    if (addedFoodId) {
      await request.delete(`/api/v1/foods/${addedFoodId}`);
      expect((await request.get(`/api/v1/foods/${addedFoodId}`)).status()).toBe(404);
    }
  }
});
