import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.use({ timezoneId: "Europe/Prague" });

test("training load reviews recorded gym work by week", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const cleanup = [];

  try {
    for (const performedAt of ["2026-10-18T21:59:59Z", "2026-10-18T22:00:00Z"]) {
      const log = await request.post("/api/v1/logs", {
        data: {
          performed_at: performedAt,
          total_time_minutes: 30,
          overall_feeling: 3,
          notes: tag,
          exercises: [{
            exercise_name: `${tag} Press`,
            sets_count: 2,
            weight_per_set: [50, 25],
            reps_per_set: [3, 8],
          }],
        },
      });
      expect(log.status()).toBe(201);
      cleanup.push(`/api/v1/logs/${(await log.json()).id}`);
    }

    await page.goto("/history");
    const trainingLoad = page.getByRole("link", { name: "Training load", exact: true });
    await expect(trainingLoad).toBeVisible();
    await trainingLoad.click();
    await expect(page.getByRole("heading", { name: "Training load", exact: true })).toBeVisible();
    await page.getByLabel("Week containing").fill("2026-10-25");
    await page.getByLabel("Weeks to show").selectOption("4");

    const table = page.getByRole("table", { name: "Weekly gym work" });
    const latest = table.getByRole("row", { name: /^2026-10-19/ });
    await expect(latest.getByRole("cell")).toHaveText(["1", "2", "350 kg"]);
    await expect(table.getByRole("row", { name: /^2026-10-12/ }).getByRole("cell")).toHaveText([
      "1", "2", "350 kg",
    ]);
    await expect(table.getByRole("row")).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      page.viewportSize()?.width,
    );
  } finally {
    for (const url of cleanup) {
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});
