import { expect, test } from "@playwright/test";

test("logs and progresses through a real multi-exercise workout grid", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `grid-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:grid]`;
  let planId;
  let sessionId;
  let completedLogId;

  try {
    page.setDefaultTimeout(5_000);
    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        description: `${tag} multi exercise fixture`,
        exercises: [
          {
            exercise_name: `${tag} Squat`,
            target_sets: 2,
            target_reps_min: 5,
            target_reps_max: 8,
            target_weight_kg: 80,
            rest_time_seconds: 1,
            notes: tag,
          },
          {
            exercise_name: `${tag} Row`,
            target_sets: 2,
            target_reps_min: 8,
            target_reps_max: 12,
            target_weight_kg: 40,
            rest_time_seconds: 1,
            notes: tag,
            group_key: `${tag} superset`,
            group_order: 0,
          },
          {
            exercise_name: `${tag} Push-up`,
            target_sets: 2,
            target_reps_min: 10,
            target_reps_max: 15,
            target_weight_kg: 0,
            rest_time_seconds: 1,
            notes: tag,
            group_key: `${tag} superset`,
            group_order: 1,
          },
        ],
      },
    });
    expect(planResponse.status()).toBe(201);
    const plan = await planResponse.json();
    planId = plan.id;

    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");
    await page.goto("/");
    await page.getByRole("button", { name: "Plans" }).click();
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} plan` })
      .getByRole("button", { name: "Start workout" })
      .click();
    await expect(page.getByRole("heading", { name: `${tag} Squat` })).toBeVisible();

    const activeResponse = await request.get("/api/v1/workout-sessions/active");
    expect(activeResponse.status()).toBe(200);
    sessionId = (await activeResponse.json()).id;

    await expect(page.getByText("0 of 6 sets")).toBeVisible();
    for (const heading of ["Set", "Previous", "kg", "Reps", "RIR", "Complete"]) {
      await expect(page.getByRole("columnheader", { name: heading }).first()).toBeVisible();
    }
    await expect(page.locator("[data-set-row]")).toHaveCount(6);
    await expect(page.locator('[data-state="current"]')).toHaveCount(1);
    await expect(page.locator('[data-state="future"]')).toHaveCount(5);
    await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(6);
    await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(12);
    const firstCompleteSize = await page
      .getByRole("button", { name: `Complete ${tag} Squat set 1` })
      .boundingBox();
    expect(firstCompleteSize).not.toBeNull();
    if (!firstCompleteSize) throw new Error("Complete action has no rendered size");
    expect(firstCompleteSize.width).toBeGreaterThanOrEqual(48);
    expect(firstCompleteSize.height).toBeGreaterThanOrEqual(48);

    const linkedGroup = page.getByRole("group", { name: `${tag} superset` });
    await expect(linkedGroup.getByRole("heading", { name: `${tag} Row` })).toBeVisible();
    await linkedGroup.locator("summary").click();
    await expect(linkedGroup.getByRole("heading", { name: `${tag} Row` })).toBeHidden();
    await linkedGroup.locator("summary").click();

    /** @param {string} exercise @param {number} setNumber */
    const row = (exercise, setNumber) =>
      page.locator(`[data-exercise-name="${exercise}"][data-set-number="${setNumber}"]`);
    const squatOne = row(`${tag} Squat`, 1);
    await squatOne.getByLabel("Weight (kg)").fill("81.25");
    await squatOne.getByLabel("Repetitions").fill("6");
    await squatOne.getByLabel("RIR").fill("3");
    await squatOne.getByRole("button", { name: `Complete ${tag} Squat set 1` }).click();
    await expect(squatOne).toHaveAttribute("data-state", "completed");
    await expect(squatOne.getByRole("button", { name: "Undo" })).toBeVisible();
    await squatOne.getByRole("button", { name: "Undo" }).click();
    await expect(squatOne).toHaveAttribute("data-state", "current");

    await squatOne.getByLabel("Weight (kg)").fill("82.5");
    await squatOne.getByLabel("Repetitions").fill("7");
    await squatOne.getByLabel("RIR").fill("2");
    await squatOne.getByRole("button", { name: `Complete ${tag} Squat set 1` }).click();
    const squatTwo = row(`${tag} Squat`, 2);
    await expect(squatTwo).toHaveAttribute("data-state", "current");
    await squatTwo.getByRole("button", { name: `Skip ${tag} Squat set 2` }).click();
    await expect(squatTwo).toHaveAttribute("data-state", "skipped");

    const rowTwo = row(`${tag} Row`, 2);
    await rowTwo.getByRole("button", { name: `Open ${tag} Row set 2` }).click();
    await expect(rowTwo).toHaveAttribute("data-state", "current");
    await rowTwo.getByLabel("Weight (kg)").fill("35");
    await rowTwo.getByLabel("Repetitions").fill("6");
    await rowTwo.getByLabel("RIR").fill("1");
    await rowTwo.getByRole("button", { name: `Complete ${tag} Row set 2` }).click();

    const rowOne = row(`${tag} Row`, 1);
    await expect(rowOne).toHaveAttribute("data-state", "current");
    await rowOne.getByLabel("Weight (kg)").fill("32.5");
    await rowOne.getByLabel("Repetitions").fill("8");
    await rowOne.getByLabel("RIR").fill("2");
    await rowOne.getByRole("button", { name: `Complete ${tag} Row set 1` }).click();
    await rowOne.getByRole("button", { name: "Edit" }).click();
    await rowOne.getByLabel("Weight (kg)").fill("33.75");
    await rowOne.getByLabel("Repetitions").fill("7");
    await rowOne.getByLabel("RIR").fill("1");
    await rowOne.getByRole("button", { name: "Save correction" }).click();

    const pushOne = row(`${tag} Push-up`, 1);
    await pushOne.getByLabel("Weight (kg)").fill("0");
    await pushOne.getByLabel("Repetitions").fill("12");
    await pushOne.getByLabel("RIR").fill("3");
    await pushOne
      .getByRole("button", { name: `Complete ${tag} Push-up set 1` })
      .click();
    await expect(page.getByText("5 of 6 sets")).toBeVisible();

    let dialogCount = 0;
    page.on("dialog", async (dialog) => {
      dialogCount += 1;
      if (dialogCount === 1) await dialog.dismiss();
      else await dialog.accept();
    });
    await page.getByRole("button", { name: "Finish workout" }).click();
    await expect(page.getByRole("heading", { name: "Active Workout" })).toBeVisible();
    await page.getByRole("button", { name: "Finish workout" }).click();
    await expect(page.getByRole("heading", { name: "Workout History" })).toBeVisible();
    expect(dialogCount).toBe(2);

    const completedResponse = await request.get(`/api/v1/workout-sessions/${sessionId}`);
    expect(completedResponse.status()).toBe(200);
    const completed = await completedResponse.json();
    completedLogId = completed.workout_log_id;
    expect(completed.status).toBe("completed");
    /** @type {Array<{set_entries: Array<{set_number: number, state: string, weight_kg: number | null, reps: number, rir: number | null}>}>} */
    const persistedExercises = completed.exercises;
    expect(
      persistedExercises.map((exercise) =>
        exercise.set_entries.map((entry) => ({
          set: entry.set_number,
          state: entry.state,
          kg: entry.weight_kg,
          reps: entry.reps,
          rir: entry.rir,
        }))
      )
    ).toEqual([
      [
        { set: 1, state: "completed", kg: 82.5, reps: 7, rir: 2 },
        { set: 2, state: "skipped", kg: 80, reps: 5, rir: null },
      ],
      [
        { set: 1, state: "completed", kg: 33.75, reps: 7, rir: 1 },
        { set: 2, state: "completed", kg: 35, reps: 6, rir: 1 },
      ],
      [{ set: 1, state: "completed", kg: 0, reps: 12, rir: 3 }],
    ]);
  } finally {
    if (!sessionId && planId) {
      const active = await request.get("/api/v1/workout-sessions/active");
      if (active.status() === 200) {
        const body = await active.json();
        if (body.source_plan_id === planId) sessionId = body.id;
      }
    }
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
      expect((await request.get(`/api/v1/workout-sessions/${sessionId}`)).status()).toBe(404);
    }
    if (completedLogId) {
      await request.delete(`/api/v1/logs/${completedLogId}`);
      expect((await request.get(`/api/v1/logs/${completedLogId}`)).status()).toBe(404);
    }
    if (planId) {
      const remainingHistory = await request.get(`/api/v1/logs?source_plan_id=${planId}`);
      expect(remainingHistory.status()).toBe(200);
      expect((await remainingHistory.json()).total).toBe(0);
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
