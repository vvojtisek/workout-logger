import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("desktop progression shows the recorded set behind the estimate", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const exerciseName = `${tag} Squat`;
  const cleanup = [];

  try {
    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} Plan`,
        exercises: [{ exercise_name: exerciseName, target_sets: 2, target_reps_min: 3, target_reps_max: 12 }],
      },
    });
    expect(plan.status()).toBe(201);
    const { id: planId } = await plan.json();
    cleanup.unshift(`/api/v1/plans/${planId}`);

    const log = await request.post("/api/v1/logs", {
      data: {
        source_plan_id: planId,
        performed_at: new Date().toISOString(),
        total_time_minutes: 30,
        overall_feeling: 3,
        notes: tag,
        exercises: [{
          exercise_name: exerciseName,
          sets_count: 2,
          weight_per_set: [100, 50],
          reps_per_set: [3, 12],
        }],
      },
    });
    expect(log.status()).toBe(201);
    cleanup.unshift(`/api/v1/logs/${(await log.json()).id}`);

    const session = await request.post("/api/v1/workout-sessions", {
      data: { source_plan_id: planId },
    });
    expect(session.status()).toBe(201);
    cleanup.unshift(`/api/v1/workout-sessions/${(await session.json()).id}`);

    await page.goto("/workout");
    await expect(page.getByRole("heading", { name: exerciseName })).toBeVisible();
    const stats = page.locator(".exercise-stats");
    await expect(stats).toContainText("Best 100 kg × 3");
    await expect(stats).toContainText("e1RM 110 kg");
    await expect(page.getByTestId("progression-card")).toContainText("100 kg × 3");
  } finally {
    for (const url of cleanup) {
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});
