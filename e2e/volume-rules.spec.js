import { expect, test } from "@playwright/test";

import { openPage } from "./support/navigation.js";
import { saveOnlySet } from "./support/workout.js";

test("labels a two-dumbbell, per-side exercise and counts its volume", async ({
  page,
  request,
}) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || `vol-${Date.now()}`}:volume]`;
  const exerciseName = `${tag} Split squat`;
  /** @type {string | undefined} */
  let exerciseId;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let sessionId;
  /** @type {string | undefined} */
  let logId;

  try {
    page.setDefaultTimeout(5_000);
    const exerciseResponse = await request.post("/api/v1/exercises", {
      data: { name: exerciseName, equipment_load_mode: "pair_db", is_unilateral: true },
    });
    expect(exerciseResponse.status()).toBe(201);
    exerciseId = (await exerciseResponse.json()).id;

    // The exercise form shows the stored rule.
    await page.goto(`/exercises/${exerciseId}/edit`);
    await expect(page.getByLabel("Weight you type")).toHaveValue("pair_db");
    await expect(page.locator("#exercise-unilateral")).toBeChecked();

    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        exercises: [
          {
            exercise_name: exerciseName,
            target_sets: 1,
            target_reps_min: 8,
            target_reps_max: 10,
            target_weight_kg: 20,
            rest_time_seconds: 30,
          },
        ],
      },
    });
    expect(planResponse.status()).toBe(201);
    planId = (await planResponse.json()).id;

    await page.goto("/");
    await openPage(page, "Plans");
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} plan` })
      .getByRole("button", { name: "Start workout" })
      .click();
    await expect(page.getByRole("heading", { name: exerciseName })).toBeVisible();
    sessionId = (await (await request.get("/api/v1/workout-sessions/active")).json()).id;

    // The weight stays one dumbbell; the inputs say so.
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("20");
    await expect(page.getByLabel("Weight (kg)")).toHaveAccessibleDescription(
      "Input: 1x DB (Vol: 2x)",
    );
    await expect(page.getByLabel("Repetitions")).toHaveAccessibleDescription("per side");
    await page.getByLabel("Repetitions").fill("8");
    await saveOnlySet(page);

    await expect
      .poll(async () => {
        const session = await (await request.get(`/api/v1/workout-sessions/${sessionId}`)).json();
        return [session.exercises[0].set_entries[0]?.weight_kg, session.total_volume_kg];
      })
      .toEqual([20, 640]);

    await page.getByRole("button", { name: "Finish workout" }).click();
    await expect(page.getByRole("heading", { name: "Workout History" })).toBeVisible();
    logId = (await (await request.get(`/api/v1/workout-sessions/${sessionId}`)).json())
      .workout_log_id;
    expect(logId).toBeTruthy();

    await page.goto(`/history/${logId}`);
    await expect(page.locator("#detail-content")).toContainText(
      "8 reps per side @ 20kg each dumbbell",
    );
    await expect(page.getByTestId("exercise-volume")).toContainText("Volume 640 kg");
  } finally {
    if (!sessionId && planId) {
      const active = await request.get("/api/v1/workout-sessions/active");
      if (active.status() === 200) {
        const body = await active.json();
        if (body.source_plan_id === planId) sessionId = body.id;
      }
    }
    if (sessionId) {
      const session = await request.get(`/api/v1/workout-sessions/${sessionId}`);
      if (session.status() === 200) logId = logId || (await session.json()).workout_log_id;
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
      expect((await request.get(`/api/v1/workout-sessions/${sessionId}`)).status()).toBe(404);
    }
    if (logId) {
      await request.delete(`/api/v1/logs/${logId}`);
      expect((await request.get(`/api/v1/logs/${logId}`)).status()).toBe(404);
    }
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
    if (exerciseId) {
      await request.delete(`/api/v1/exercises/${exerciseId}`);
      expect((await request.get(`/api/v1/exercises/${exerciseId}`)).status()).toBe(404);
    }
  }
});
