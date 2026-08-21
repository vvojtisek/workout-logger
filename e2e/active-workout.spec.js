import { expect, test } from "@playwright/test";

test("starts, saves, resumes, completes, and cleans up a real active workout", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `e2e-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}]`;
  let planId;
  let priorLogId;
  let completedLogId;
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} active plan`,
        description: `${tag} active workout fixture`,
        exercises: [
          {
            exercise_name: `${tag} Bench Press`,
            target_sets: 1,
            target_reps_min: 8,
            target_reps_max: 10,
            target_weight_kg: 42.5,
            rest_time_seconds: 90,
            notes: tag,
          },
        ],
      },
    });
    expect(planResponse.status()).toBe(201);
    planId = (await planResponse.json()).id;

    const priorLogResponse = await request.post("/api/v1/logs", {
      data: {
        source_plan_id: planId,
        performed_at: new Date(Date.now() - 86_400_000).toISOString(),
        total_time_minutes: 30,
        overall_feeling: 4,
        notes: `${tag} prior history fixture`,
        exercises: [
          {
            exercise_name: `${tag} Bench Press`,
            sets_count: 1,
            reps_per_set: [7],
            weight_kg: 47.5,
            rest_time_seconds: 90,
            notes: tag,
          },
        ],
      },
    });
    expect(priorLogResponse.status()).toBe(201);
    priorLogId = (await priorLogResponse.json()).id;

    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");
    await page.goto("/");
    await page.getByRole("button", { name: "Plans" }).click();
    const planItem = page.getByRole("listitem").filter({ hasText: `${tag} active plan` });
    await planItem.getByRole("button", { name: "Start workout" }).click();

    await expect(page.getByRole("heading", { name: `${tag} Bench Press` })).toBeVisible();
    await expect(page.getByText("Suggested from history · not saved")).toBeVisible();
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("47.5");
    await expect(page.getByLabel("Repetitions")).toHaveValue("7");

    const activeResponse = await request.get("/api/v1/workout-sessions/active");
    expect(activeResponse.status()).toBe(200);
    const active = await activeResponse.json();
    sessionId = active.id;
    expect(active.source_plan_id).toBe(planId);

    await page.getByLabel("RIR").fill("2");
    await page.getByRole("button", { name: "Save set" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.getByText(/Rest: \d+s/)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: `${tag} Bench Press` })).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("47.5");
    await expect(page.getByLabel("Repetitions")).toHaveValue("7");
    await expect(page.getByLabel("RIR")).toHaveValue("2");
    await expect(page.getByText(/Rest: \d+s/)).toBeVisible();

    await page.getByLabel("Overall feeling").selectOption("4");
    await page.getByRole("button", { name: "Finish workout" }).click();
    await expect(page.getByRole("heading", { name: "Workout History" })).toBeVisible();
    await expect(page.getByText(`${tag} active plan`)).toBeVisible();

    const completedSession = await request.get(`/api/v1/workout-sessions/${sessionId}`);
    expect(completedSession.status()).toBe(200);
    completedLogId = (await completedSession.json()).workout_log_id;
    expect(completedLogId).toBeTruthy();

    const completedHistory = await request.get(`/api/v1/logs/${completedLogId}`);
    expect(completedHistory.status()).toBe(200);
    const completedHistoryBody = await completedHistory.json();
    expect(completedHistoryBody.source_plan_name).toBe(`${tag} active plan`);
    expect(completedHistoryBody.exercises[0].reps_per_set).toEqual([7]);
    expect(completedHistoryBody.exercises[0].weight_kg).toBe(47.5);
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
    for (const logId of [completedLogId, priorLogId]) {
      if (logId) {
        await request.delete(`/api/v1/logs/${logId}`);
        expect((await request.get(`/api/v1/logs/${logId}`)).status()).toBe(404);
      }
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
