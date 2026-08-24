import { expect, test } from "@playwright/test";

/** @param {number} hour */
function todayDatetimeLocal(hour) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${String(hour).padStart(2, "0")}:00`;
}

test("builds a food and nutrition plan, logs a meal, and verifies the daily dashboard through the GUI", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `nutrition-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:nutrition]`;

  let foodId;
  let planId;
  let entryId;

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");

    await page.goto("/");
    await page.getByRole("button", { name: "Nutrition" }).click();
    await expect(page.getByRole("heading", { name: "Nutrition" })).toBeVisible();

    // Build the food entirely through the GUI.
    await page.getByRole("button", { name: "Foods" }).click();
    await expect(page.getByRole("heading", { name: "Foods" })).toBeVisible();
    await page.getByRole("button", { name: "New food" }).click();
    await expect(page.getByRole("heading", { name: "New Food" })).toBeVisible();
    await page.getByLabel("Name").fill(`${tag} Chicken Breast`);
    await page.getByLabel("Serving quantity").fill("100");
    await page.getByLabel("Serving unit").fill("g");
    await page.getByLabel("Energy (kcal)").fill("165");
    await page.getByLabel("Protein (g)").fill("31");
    await page.getByLabel("Carbohydrate (g)").fill("0");
    await page.getByLabel("Fat (g)").fill("3.6");
    await page.getByRole("button", { name: "Create food" }).click();
    await expect(page.getByRole("heading", { name: "Foods" })).toBeVisible();

    const foodsList = await request.get("/api/v1/foods?limit=100");
    /** @type {{items: Array<{id: string, name: string}>}} */
    const foodsBody = await foodsList.json();
    const createdFood = foodsBody.items.find((food) => food.name === `${tag} Chicken Breast`);
    expect(createdFood).toBeTruthy();
    foodId = createdFood?.id;

    // Build the nutrition plan through the GUI, covering today.
    await page.goto("/nutrition/plans");
    await page.getByRole("button", { name: "New plan" }).click();
    await expect(page.getByRole("heading", { name: "New Nutrition Plan" })).toBeVisible();
    await page.getByLabel("Name").fill(`${tag} plan`);
    const today = todayDatetimeLocal(0).slice(0, 10);
    await page.getByLabel("Start date").fill(today);
    await page.getByLabel("Energy target (kcal)").fill("2000");
    await page.getByLabel("Protein target (g)").fill("150");
    await page.getByLabel("Carbohydrate target (g)").fill("200");
    await page.getByLabel("Fat target (g)").fill("60");
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect(page.getByRole("heading", { name: "Nutrition Plans" })).toBeVisible();

    const plansList = await request.get("/api/v1/nutrition-plans?limit=100");
    /** @type {{items: Array<{id: string, name: string}>}} */
    const plansBody = await plansList.json();
    const createdPlan = plansBody.items.find((plan) => plan.name === `${tag} plan`);
    expect(createdPlan).toBeTruthy();
    planId = createdPlan?.id;

    // Log a meal with a food-backed item and an ad hoc item, through the GUI.
    await page.goto("/nutrition/meals");
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByRole("heading", { name: "Log Meal" })).toBeVisible();
    await page.getByLabel("Date and time").fill(todayDatetimeLocal(8));
    await page.getByLabel("Meal type").selectOption("breakfast");

    await page
      .getByLabel("Food")
      .selectOption({ label: `${tag} Chicken Breast (100 g)` });
    await page.getByLabel(/^Quantity \(g\)$/).fill("150");

    await page.getByRole("button", { name: "+ Add item" }).click();
    await page.getByRole("button", { name: "Toggle item 2 entry mode" }).click();
    await page.getByLabel("Name").fill(`${tag} Oatmeal`);
    await page.getByLabel("Quantity", { exact: true }).fill("1");
    await page.getByLabel("Unit").fill("cup");
    await page.getByLabel("Energy (kcal)").fill("150");
    await page.getByLabel("Protein (g)").fill("5");
    await page.getByLabel("Carbohydrate (g)").fill("27");
    await page.getByLabel("Fat (g)").fill("3");

    await page.getByRole("button", { name: "Log meal", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Meal Log" })).toBeVisible();

    const entriesList = await request.get("/api/v1/meal-entries?limit=100");
    /** @type {{items: Array<{id: string, items: Array<{food_name_snapshot: string, energy_kcal_snapshot: number}>}>}} */
    const entriesBody = await entriesList.json();
    const createdEntry = entriesBody.items.find((entry) =>
      entry.items.some((item) => item.food_name_snapshot === `${tag} Chicken Breast`),
    );
    expect(createdEntry).toBeTruthy();
    entryId = createdEntry?.id;

    const entryDetail = await request.get(`/api/v1/meal-entries/${entryId}`);
    const detailBody = await entryDetail.json();
    const chickenItem = detailBody.items.find(
      (/** @type {{food_name_snapshot: string}} */ item) =>
        item.food_name_snapshot === `${tag} Chicken Breast`,
    );
    expect(chickenItem).toMatchObject({ energy_kcal_snapshot: 247.5, protein_g_snapshot: 46.5 });
    const oatmealItem = detailBody.items.find(
      (/** @type {{food_name_snapshot: string}} */ item) =>
        item.food_name_snapshot === `${tag} Oatmeal`,
    );
    expect(oatmealItem).toMatchObject({ food_id: null, energy_kcal_snapshot: 150 });

    // The daily dashboard (defaults to today) reflects the logged totals and target.
    await page.goto("/nutrition");
    await expect(page.getByText("398 / 2000 kcal")).toBeVisible();
    await expect(page.getByText(`Target: ${tag} plan`)).toBeVisible();

    // Delete the meal entry through the GUI and confirm the dashboard reverts.
    await page.goto("/nutrition/meals");
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} Chicken Breast` })
      .getByRole("button", { name: "Delete" })
      .click();
    await page
      .getByRole("dialog", { name: "Delete meal entry" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(
      page.locator("#meal-entries-list").getByText(`${tag} Chicken Breast`),
    ).toBeHidden();

    const afterDelete = await request.get(`/api/v1/meal-entries/${entryId}`);
    expect(afterDelete.status()).toBe(404);
    entryId = undefined;

    await page.goto("/nutrition");
    await expect(page.getByText("0 / 2000 kcal")).toBeVisible();
  } finally {
    if (entryId) {
      await request.delete(`/api/v1/meal-entries/${entryId}`);
    }
    if (planId) {
      await request.delete(`/api/v1/nutrition-plans/${planId}`);
      expect((await request.get(`/api/v1/nutrition-plans/${planId}`)).status()).toBe(404);
    }
    if (foodId) {
      await request.delete(`/api/v1/foods/${foodId}`);
      expect((await request.get(`/api/v1/foods/${foodId}`)).status()).toBe(404);
    }
  }
});
