import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("catalogue progression reviews completed lifts without an active workout", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const name = `${tag} Floor press`;
  const cleanup = [];

  try {
    const exercise = await request.post("/api/v1/exercises", { data: { name } });
    expect(exercise.status()).toBe(201);
    const { id } = await exercise.json();
    cleanup.unshift(`/api/v1/exercises/${id}`);

    const log = await request.post("/api/v1/logs", {
      data: {
        performed_at: new Date().toISOString(),
        total_time_minutes: 30,
        overall_feeling: 3,
        notes: tag,
        exercises: [{
          exercise_name: name,
          sets_count: 3,
          weight_kg: 50,
          weight_per_set: [60, 60, 50],
          reps_per_set: [6, 3, 7],
        }],
      },
    });
    expect(log.status()).toBe(201);
    cleanup.unshift(`/api/v1/logs/${(await log.json()).id}`);

    const stats = await request.get(`/api/v1/exercise-stats?${new URLSearchParams({ name })}`);
    expect(stats.status()).toBe(200);
    const exerciseStats = (await stats.json()).items[0];
    expect(exerciseStats.estimated_one_rep_max_kg).toBe(72);
    expect(exerciseStats.rep_retention).toEqual([
      { weight_kg: 60, reps_per_set: [6, 3], retention_percent: 50 },
    ]);
    await page.goto(`/exercises/${id}`);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const panel = page.getByTestId("progression-card");
    await expect(panel).toContainText("Best 60 kg × 6");
    await expect(panel).toContainText("60 kg · 6 → 3");
    await expect(panel).toContainText("50% retained");
    await expect(panel.getByRole("img", { name: "60 kg same-load rep curve: 6, 3 reps by set" })).toBeVisible();
    await expect(panel).toContainText("e1RM 72 kg");
    await panel.getByRole("combobox", { name: "History range" }).selectOption("30");
    await panel.getByRole("combobox", { name: "1RM formula" }).selectOption("brzycki");
    await expect(panel).toContainText("e1RM 69.5 kg");
    await expect(panel.getByTestId("progression-chart")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      page.viewportSize()?.width,
    );
    expect((await request.get("/api/v1/workout-sessions/active")).status()).toBe(404);
  } finally {
    for (const url of cleanup) {
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});
