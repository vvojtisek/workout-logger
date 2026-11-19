import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("Nutrition charts use the target from each logged date and open filtered entries", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const cleanup = [];
  /** @param {number} days */
  const date = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const early = date(3);
  const late = date(1);

  try {
    for (const [from, to, suffix, protein] of [[early, early, "early", 88], [late, late, "late", 127]]) {
      const plan = await request.post("/api/v1/nutrition-plans", {
        data: {
          name: `${tag} ${suffix}`, valid_from: from, valid_to: to,
          energy_target_kcal: 2150, protein_target_g: protein, carbohydrate_target_g: 200, fat_target_g: 75,
        },
      });
      expect(plan.status()).toBe(201);
      cleanup.push(`/api/v1/nutrition-plans/${(await plan.json()).id}`);
      const meal = await request.post("/api/v1/meal-entries", {
        data: {
          consumed_at: `${from}T12:00:00Z`,
          meal_type: "lunch",
          notes: tag,
          items: [{
            quantity: 1, unit: "serving", food_name_snapshot: `${tag} meal ${suffix}`,
            energy_kcal: 420, protein_g: 32, carbohydrate_g: 45, fat_g: 12, fiber_g: 6,
          }],
        },
      });
      expect(meal.status()).toBe(201);
      cleanup.push(`/api/v1/meal-entries/${(await meal.json()).id}`);
    }

    await page.goto("/nutrition");
    await expect(page.locator("#meal-entries-list")).toHaveCount(0);
    await page.getByRole("link", { name: "See all nutrition trends" }).click();
    await page.getByLabel("Date range").selectOption("7");
    await page.getByLabel("Statistic").selectOption("protein_g");
    const chart = page.getByRole("region", { name: "Protein (g)" });
    await chart.getByText("Chart data", { exact: true }).click();
    await expect(chart.getByRole("row", { name: new RegExp(early) })).toContainText("88");
    await expect(chart.getByRole("row", { name: new RegExp(late) })).toContainText("127");
    await expect(chart.getByRole("row", { name: new RegExp(date(2)) })).toHaveCount(0);
    await chart.getByRole("link", { name: late, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/nutrition/meals\\?from=${late}&to=${late}$`));
    await expect(page.getByText(`${tag} meal late`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag} meal early`, { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Clear dates" }).click();
    await expect(page.getByText(`${tag} meal early`, { exact: true })).toBeVisible();
  } finally {
    for (const path of cleanup.reverse()) {
      expect((await request.delete(path)).status()).toBe(204);
      expect((await request.get(path)).status()).toBe(404);
    }
  }
});
