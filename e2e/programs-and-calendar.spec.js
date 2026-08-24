import { expect, test } from "@playwright/test";

function todayIso() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

test("schedules, starts, reschedules, skips, and unschedules a real workout through the calendar GUI", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `calendar-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:calendar]`;
  const today = todayIso();
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let programId;
  /** @type {string | undefined} */
  let scheduledId;
  /** @type {string | undefined} */
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");

    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        exercises: [
          {
            exercise_name: `${tag} Row`,
            target_sets: 1,
            target_reps_min: 5,
            target_reps_max: 8,
            rest_time_seconds: 30,
          },
        ],
      },
    });
    expect(planResponse.status()).toBe(201);
    planId = (await planResponse.json()).id;

    // Build the program entirely through the GUI.
    await page.goto("/");
    await page.getByRole("button", { name: "Programs" }).click();
    await expect(page.getByRole("heading", { name: "Programs" })).toBeVisible();
    await page.getByRole("button", { name: "New program" }).click();
    await expect(page.getByRole("heading", { name: "New Program" })).toBeVisible();
    await page.getByLabel("Name").fill(`${tag} program`);
    await page.getByLabel("Kind").fill("Hypertrophy");
    await page.getByLabel("Start date").fill(today);
    await page.getByRole("button", { name: "Create program" }).click();
    await expect(page.getByRole("heading", { name: "Programs" })).toBeVisible();

    const programList = await request.get("/api/v1/programs?limit=100");
    /** @type {{items: Array<{id: string, name: string}>}} */
    const programListBody = await programList.json();
    const createdProgram = programListBody.items.find(
      (program) => program.name === `${tag} program`,
    );
    expect(createdProgram).toBeTruthy();
    programId = createdProgram?.id;

    // Schedule the plan on today through the calendar GUI.
    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await page.getByRole("button", { name: `Schedule a workout on ${today}` }).click();
    await expect(page.getByRole("heading", { name: /^Schedule a workout/ })).toBeVisible();
    await page.getByLabel("Workout plan").selectOption({ label: `${tag} plan` });
    await page.getByLabel("Program (optional)").selectOption({ label: `${tag} program` });
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(page.getByRole("button", { name: `${tag} plan` })).toBeVisible();

    const calendarResponse = await request.get(
      `/api/v1/calendar?from=${today}&to=${today}`,
    );
    expect(calendarResponse.status()).toBe(200);
    /** @type {{items: Array<{id: string, workout_plan_id: string}>}} */
    const calendarBody = await calendarResponse.json();
    const scheduled = calendarBody.items.find((item) => item.workout_plan_id === planId);
    expect(scheduled).toMatchObject({
      program_id: programId,
      scheduled_date: today,
      status: "scheduled",
    });
    scheduledId = scheduled?.id;

    // Reschedule: move it one day into the future, then back to today.
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);

    await page.getByRole("button", { name: `${tag} plan` }).click();
    await expect(page.getByRole("heading", { name: `${tag} plan` })).toBeVisible();
    await page.locator("#reschedule-date").fill(tomorrowIso);
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    const afterMove = await request.get(`/api/v1/scheduled-workouts/${scheduledId}`);
    expect((await afterMove.json()).scheduled_date).toBe(tomorrowIso);

    // Move it back to today so the rest of the test can find it in this month view.
    const moveBackResponse = await request.patch(
      `/api/v1/scheduled-workouts/${scheduledId}`,
      { data: { scheduled_date: today } },
    );
    expect(moveBackResponse.status()).toBe(200);
    await page.reload();

    // Skip, then unskip, through the GUI.
    await page.getByRole("button", { name: `${tag} plan` }).click();
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    let afterSkip = await request.get(`/api/v1/scheduled-workouts/${scheduledId}`);
    expect((await afterSkip.json()).status).toBe("skipped");

    await page.getByRole("button", { name: `${tag} plan` }).click();
    await page.getByRole("button", { name: "Unskip" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    afterSkip = await request.get(`/api/v1/scheduled-workouts/${scheduledId}`);
    expect((await afterSkip.json()).status).toBe("scheduled");

    // Start it: hands off to the real active-workout session.
    await page.getByRole("button", { name: `${tag} plan` }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("heading", { name: `${tag} Row` })).toBeVisible();

    const activeResponse = await request.get("/api/v1/workout-sessions/active");
    expect(activeResponse.status()).toBe(200);
    sessionId = (await activeResponse.json()).id;

    const afterStart = await request.get(`/api/v1/scheduled-workouts/${scheduledId}`);
    expect(await afterStart.json()).toMatchObject({
      status: "in_progress",
      workout_session_id: sessionId,
    });

    // Cancel the session; the scheduled workout should revert automatically.
    await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    sessionId = undefined;
    const afterCancel = await request.get(`/api/v1/scheduled-workouts/${scheduledId}`);
    expect(await afterCancel.json()).toMatchObject({ status: "scheduled", workout_session_id: null });

    // Delete through the GUI and prove it is gone.
    await page.goto("/calendar");
    await page.getByRole("button", { name: `${tag} plan` }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("button", { name: `${tag} plan` })).toBeHidden();

    const afterDelete = await request.get(`/api/v1/scheduled-workouts/${scheduledId}`);
    expect(afterDelete.status()).toBe(404);
    scheduledId = undefined;
  } finally {
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    }
    if (scheduledId) {
      await request.delete(`/api/v1/scheduled-workouts/${scheduledId}`);
    }
    if (programId) {
      await request.delete(`/api/v1/programs/${programId}`);
      expect((await request.get(`/api/v1/programs/${programId}`)).status()).toBe(404);
    }
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
