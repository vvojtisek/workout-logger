import { expect, test } from "@playwright/test";

test("builds a plan with bodyweight and cardio exercises and logs kind-specific sets", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `kinds-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:kinds]`;
  let planId;
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");
    await page.goto("/");
    await page.getByRole("button", { name: "Plans" }).click();

    // Build a mixed-kind plan entirely through the GUI.
    await page.getByRole("button", { name: "New program" }).click();
    await page.getByLabel("Plan name").fill(`${tag} plan`);

    await page.getByRole("button", { name: "+ Add compound exercise" }).click();
    await page.getByRole("button", { name: "+ Add compound exercise" }).click();

    const rows = page.locator("#plan-exercises-list > div");
    const bodyweightRow = rows.nth(0);
    const cardioRow = rows.nth(1);

    await bodyweightRow.getByLabel("Exercise name").fill(`${tag} Pull-up`);
    await bodyweightRow.getByLabel("Exercise type").selectOption("bodyweight");

    await cardioRow.getByLabel("Exercise name").fill(`${tag} Row Erg`);
    await cardioRow.getByLabel("Exercise type").selectOption("cardio");

    await page.getByRole("button", { name: "Create program" }).click();
    await expect(page.getByRole("heading", { name: "Workout Plans" })).toBeVisible();

    // Read the created plan back through the real API to confirm both kinds saved.
    const list = await request.get("/api/v1/plans?limit=100");
    /** @type {{items: Array<{id: string, name: string}>}} */
    const listBody = await list.json();
    const created = listBody.items.find((plan) => plan.name === `${tag} plan`);
    expect(created).toBeTruthy();
    planId = created?.id;

    const read = await request.get(`/api/v1/plans/${planId}`);
    /** @type {{exercises: Array<{exercise_name: string, exercise_kind: string}>}} */
    const readBody = await read.json();
    const kindByName = Object.fromEntries(
      readBody.exercises.map((ex) => [ex.exercise_name, ex.exercise_kind])
    );
    expect(kindByName[`${tag} Pull-up`]).toBe("bodyweight");
    expect(kindByName[`${tag} Row Erg`]).toBe("cardio");

    // Start the workout and log one set of each kind through the real grid.
    const planCard = page.getByRole("listitem").filter({ hasText: `${tag} plan` });
    await planCard.getByRole("button", { name: "Start workout" }).click();
    await expect(page.getByRole("heading", { name: `${tag} Pull-up` })).toBeVisible();

    const activeResponse = await request.get("/api/v1/workout-sessions/active");
    expect(activeResponse.status()).toBe(200);
    sessionId = (await activeResponse.json()).id;

    /** @param {string} exercise @param {number} setNumber */
    const setRow = (exercise, setNumber) =>
      page.locator(`[data-exercise-name="${exercise}"][data-set-number="${setNumber}"]`);

    const bodyweightSet = setRow(`${tag} Pull-up`, 1);
    await bodyweightSet.getByLabel("Added weight (kg)").fill("5");
    await bodyweightSet.getByLabel("Repetitions").fill("12");
    await bodyweightSet.getByLabel("Band level").fill("medium");
    await bodyweightSet
      .getByRole("button", { name: `Complete ${tag} Pull-up set 1` })
      .click();
    await expect(bodyweightSet).toHaveAttribute("data-state", "completed");

    const cardioSet = setRow(`${tag} Row Erg`, 1);
    await cardioSet.getByLabel("Duration (seconds)").fill("1800");
    await cardioSet.getByLabel("Distance (km)").fill("5.2");
    await cardioSet.getByLabel("Incline (%)").fill("2.5");
    await cardioSet
      .getByRole("button", { name: `Complete ${tag} Row Erg set 1` })
      .click();
    await expect(cardioSet).toHaveAttribute("data-state", "completed");

    const session = await request.get(`/api/v1/workout-sessions/${sessionId}`);
    /** @type {{exercises: Array<{exercise_name: string, exercise_kind: string, set_entries: Array<Record<string, unknown>>}>}} */
    const sessionBody = await session.json();
    const bodyweightEntry = sessionBody.exercises.find(
      (ex) => ex.exercise_name === `${tag} Pull-up`
    )?.set_entries[0];
    const cardioEntry = sessionBody.exercises.find(
      (ex) => ex.exercise_name === `${tag} Row Erg`
    )?.set_entries[0];

    expect(bodyweightEntry).toMatchObject({
      added_weight_kg: 5,
      reps: 12,
      band_level: "medium",
    });
    expect(cardioEntry).toMatchObject({
      duration_seconds: 1800,
      distance_km: 5.2,
      incline_percent: 2.5,
    });
  } finally {
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    }
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
