import { expect, test } from "@playwright/test";
import { isDesktop, openPage } from "./support/navigation.js";
import { clickAndAwaitWrite } from "./support/writes.js";

function todayIso() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** @param {string} isoDate @param {number} days */
function addUtcDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("schedules, starts, reschedules, skips, and unschedules a real workout through the calendar GUI", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `calendar-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:calendar]`;
  const today = todayIso();
  const blockEnd = addUtcDays(today, 27);
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let programId;
  /** @type {string | undefined} */
  let scheduledId;
  /** @type {string | undefined} */
  let secondScheduledId;
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
    await openPage(page, "Programs");
    await expect(page.getByRole("heading", { name: "Programs", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New program" }).click();
    await expect(page.getByRole("heading", { name: "New Program" })).toBeVisible();
    await page.getByLabel("Name").fill(`${tag} program`);
    await page.getByLabel("Kind").fill("Hypertrophy");
    await page.getByLabel("Start date").fill(today);
    await page.getByLabel("End date (optional)").fill(blockEnd);
    await clickAndAwaitWrite(page, page.getByRole("button", { name: "Create program" }), "POST");
    await expect(page.getByRole("heading", { name: "Programs", exact: true })).toBeVisible();
    const programRow = page.locator("#programs-list").getByRole("listitem", { name: `${tag} program` });
    await expect(programRow.getByTestId("program-week-summary")).toContainText("Week 1 of 4 · 4% elapsed");

    const programList = await request.get("/api/v1/programs?limit=100");
    /** @type {{items: Array<{id: string, name: string}>}} */
    const programListBody = await programList.json();
    const createdProgram = programListBody.items.find(
      (program) => program.name === `${tag} program`,
    );
    expect(createdProgram).toBeTruthy();
    programId = createdProgram?.id;

    // Schedule the plan on today through the calendar GUI.
    await openPage(page, "Calendar");
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    // Weeks start on Monday, whatever the browser locale.
    await expect(page.locator("#calendar-weekdays > div")).toHaveText([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
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

    await openPage(page, "Programs");
    const programCard = page
      .locator("#programs-list")
      .getByRole("listitem")
      .filter({ hasText: `${tag} program` });
    await expect(programCard.getByTestId("program-schedule-summary")).toContainText(
      /Scheduled 1.*In progress 0.*Completed 0.*Skipped 0/,
    );
    await expect(programCard.getByTestId("program-week-schedule-summary")).toContainText(
      /Week 1.*Scheduled 1.*In progress 0.*Completed 0.*Skipped 0/,
    );
    const nextWeekResponse = await request.post("/api/v1/scheduled-workouts", {
      data: {
        program_id: programId,
        workout_plan_id: planId,
        scheduled_date: addUtcDays(today, 7),
      },
    });
    expect(nextWeekResponse.status()).toBe(201);
    secondScheduledId = (await nextWeekResponse.json()).id;
    await page.reload();
    const refreshedProgramCard = page
      .locator("#programs-list")
      .getByRole("listitem")
      .filter({ hasText: `${tag} program` });
    await refreshedProgramCard.getByText("Week-by-week states", { exact: true }).click();
    const weeklyStates = refreshedProgramCard.getByRole("table", {
      name: `${tag} program weekly schedule states`,
    });
    await expect(weeklyStates.getByRole("row")).toHaveCount(3);
    const weekOne = weeklyStates.getByRole("row", { name: /Week 1/ });
    await expect(weekOne.getByRole("cell")).toHaveText(["1", "0", "0", "0"]);
    const weekTwo = weeklyStates.getByRole("row", { name: /Week 2/ });
    await expect(weekTwo.getByRole("cell")).toHaveText(["1", "0", "0", "0"]);
    await request.delete(`/api/v1/scheduled-workouts/${secondScheduledId}`);
    expect((await request.get(`/api/v1/scheduled-workouts/${secondScheduledId}`)).status()).toBe(404);
    secondScheduledId = undefined;
    await page.reload();

    // Reschedule: move it one day into the future, then back to today.
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);

    await openPage(page, "Calendar");
    await page.getByRole("button", { name: `${tag} plan` }).click();
    await expect(page.getByRole("heading", { name: `${tag} plan` })).toBeVisible();
    await expect(page.locator("#reschedule-date")).toHaveAttribute("type", "text");
    await expect(page.locator("#reschedule-date")).toHaveAttribute("placeholder", "YYYY-MM-DD");
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

    if (!isDesktop(page)) {
      await page.getByRole("button", { name: "Minimize workout" }).click();
    }
    await openPage(page, "Programs");
    await expect(
      page
        .locator("#programs-list")
        .getByRole("listitem")
        .filter({ hasText: `${tag} program` })
        .getByTestId("program-schedule-summary"),
    ).toContainText(/Scheduled 0.*In progress 1.*Completed 0.*Skipped 0/);
    await expect(
      page
        .locator("#programs-list")
        .getByRole("listitem")
        .filter({ hasText: `${tag} program` })
        .getByTestId("program-week-schedule-summary"),
    ).toContainText(/Week 1.*Scheduled 0.*In progress 1.*Completed 0.*Skipped 0/);

    const afterStart = await request.get(`/api/v1/scheduled-workouts/${scheduledId}`);
    expect(await afterStart.json()).toMatchObject({
      status: "in_progress",
      workout_session_id: sessionId,
    });

    // Cancel the session; the scheduled workout should revert automatically.
    await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    sessionId = undefined;
    await openPage(page, "Programs");
    await expect(
      page
        .locator("#programs-list")
        .getByRole("listitem")
        .filter({ hasText: `${tag} program` })
        .getByTestId("program-schedule-summary"),
    ).toContainText(/Scheduled 1.*In progress 0.*Completed 0.*Skipped 0/);
    await openPage(page, "Calendar");
    const afterCancel = await request.get(`/api/v1/scheduled-workouts/${scheduledId}`);
    expect(await afterCancel.json()).toMatchObject({ status: "scheduled", workout_session_id: null });

    // Delete through the GUI and prove it is gone.
    await page.goto("/calendar");
    await page.getByRole("button", { name: `${tag} plan` }).click();
    await clickAndAwaitWrite(page, page.getByRole("button", { name: "Delete" }), "DELETE");
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
    if (secondScheduledId) {
      await request.delete(`/api/v1/scheduled-workouts/${secondScheduledId}`);
      expect((await request.get(`/api/v1/scheduled-workouts/${secondScheduledId}`)).status()).toBe(404);
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
