import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.use({ timezoneId: "Europe/Prague" });

test("training load reviews recorded gym work by week", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const cleanup = [];

  try {
    const exercise = await request.post("/api/v1/exercises", {
      data: {
        name: `${tag} Press`,
        primary_muscles: ["chest", "triceps"],
        secondary_muscles: ["shoulders"],
      },
    });
    expect(exercise.status()).toBe(201);
    cleanup.push(`/api/v1/exercises/${(await exercise.json()).id}`);
    for (const [performedAt, exerciseName] of [
      ["2026-10-18T21:59:59Z", `${tag} Unknown press`],
      ["2026-10-18T22:00:00Z", `${tag} Press`],
    ]) {
      const log = await request.post("/api/v1/logs", {
        data: {
          performed_at: performedAt,
          total_time_minutes: 30,
          overall_feeling: 3,
          notes: tag,
          exercises: [{
            exercise_name: exerciseName,
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
    const breakdown = page.getByRole("table", { name: "External volume by primary muscle" });
    await expect(breakdown.getByRole("row", { name: /^Chest/ })).toContainText("175 kg");
    await expect(breakdown.getByRole("row", { name: /^Triceps/ })).toContainText("175 kg");
    await expect(breakdown.getByRole("row", { name: /^Shoulders/ })).toHaveCount(0);
    await page.getByLabel("Muscle breakdown week").selectOption("2026-10-12");
    await expect(breakdown.getByRole("row", { name: /^Unclassified/ })).toContainText("350 kg");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      page.viewportSize()?.width,
    );
  } finally {
    for (const url of cleanup.reverse()) {
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});
