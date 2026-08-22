import { expect, test } from "@playwright/test";

test("builds, edits, and deletes a real superset plan through the GUI", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `builder-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:builder]`;
  let planId;
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");
    await page.goto("/");
    await page.getByRole("button", { name: "Plans" }).click();
    await expect(page.getByRole("heading", { name: "Workout Plans" })).toBeVisible();

    // Build a two-exercise superset plan entirely through the UI.
    await page.getByRole("button", { name: "New program" }).click();
    await expect(page.getByRole("heading", { name: "New Program" })).toBeVisible();

    await page.getByLabel("Plan name").fill(`${tag} plan`);
    await page.getByLabel("Description").fill(`${tag} superset fixture`);

    await page.getByRole("button", { name: "+ Add exercise" }).click();
    await page.getByRole("button", { name: "+ Add exercise" }).click();

    const rows = page.locator("#plan-exercises-list > div");
    await expect(rows).toHaveCount(2);
    const rowOne = rows.nth(0);
    const rowTwo = rows.nth(1);

    await rowOne.getByLabel("Exercise name").fill(`${tag} Squat`);
    await rowOne.getByLabel("Target sets").fill("4");
    await rowOne.getByLabel("Min reps").fill("5");
    await rowOne.getByLabel("Max reps").fill("8");
    await rowOne.getByLabel("Target weight (kg)").fill("100");
    await rowOne.getByLabel("Rest seconds").fill("90");
    await rowOne.getByLabel("Superset group").fill(`${tag} superset`);

    await rowTwo.getByLabel("Exercise name").fill(`${tag} Lunge`);
    await rowTwo.getByLabel("Target sets").fill("3");
    await rowTwo.getByLabel("Min reps").fill("10");
    await rowTwo.getByLabel("Max reps").fill("12");
    await rowTwo.getByLabel("Target weight (kg)").fill("20");
    await rowTwo.getByLabel("Rest seconds").fill("45");
    await rowTwo.getByLabel("Superset group").fill(`${tag} superset`);

    await page.getByRole("button", { name: "Create program" }).click();
    await expect(page.getByRole("heading", { name: "Workout Plans" })).toBeVisible();

    // Capture the id immediately so a later assertion failure still lets the
    // finally block find and delete this record.
    const list = await request.get("/api/v1/plans?limit=100");
    expect(list.status()).toBe(200);
    /** @type {{items: Array<{id: string, name: string}>}} */
    const listBody = await list.json();
    const created = listBody.items.find((plan) => plan.name === `${tag} plan`);
    expect(created).toBeTruthy();
    planId = created?.id;

    // Read it back through the real API, no route interception.
    await expect(page.locator("#plans-list").getByText(`${tag} plan`, { exact: true })).toBeVisible();

    const read = await request.get(`/api/v1/plans/${planId}`);
    expect(read.status()).toBe(200);
    /** @type {{exercises: Array<{exercise_name: string, target_sets: number, target_reps_min: number, target_reps_max: number, target_weight_kg: number | null, rest_time_seconds: number, group_key: string | null, group_order: number | null}>}} */
    const readBody = await read.json();
    const byName = (/** @type {string} */ name) =>
      readBody.exercises.find((ex) => ex.exercise_name === name);
    const squat = byName(`${tag} Squat`);
    const lunge = byName(`${tag} Lunge`);
    expect(squat).toMatchObject({
      target_sets: 4,
      target_reps_min: 5,
      target_reps_max: 8,
      target_weight_kg: 100,
      rest_time_seconds: 90,
      group_key: `${tag} superset`,
      group_order: 0,
    });
    expect(lunge).toMatchObject({
      target_sets: 3,
      target_reps_min: 10,
      target_reps_max: 12,
      target_weight_kg: 20,
      rest_time_seconds: 45,
      group_key: `${tag} superset`,
      group_order: 1,
    });

    // Creating a second plan with the same name must surface the 409 inline,
    // never as a native alert.
    await page.getByRole("button", { name: "New program" }).click();
    await page.getByLabel("Plan name").fill(`${tag} plan`);
    await page.getByRole("button", { name: "Create program" }).click();
    await expect(page.getByText(/already exists/i)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Workout Plans" })).toBeVisible();

    // Start a session from the superset plan to prove it integrates with the
    // active-workout grid, then leave it uncompleted (cleaned up below).
    const planCard = page.getByRole("listitem").filter({ hasText: `${tag} plan` });
    await planCard.getByRole("button", { name: "Start workout" }).click();
    await expect(page.getByRole("heading", { name: `${tag} Squat` })).toBeVisible();
    await expect(page.getByRole("heading", { name: `${tag} Lunge` })).toBeVisible();
    const activeResponse = await request.get("/api/v1/workout-sessions/active");
    expect(activeResponse.status()).toBe(200);
    sessionId = (await activeResponse.json()).id;
    await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    sessionId = undefined;

    // The session was cancelled server-side while still on /workout, where
    // global nav is hidden; a full navigation is needed to get back.
    await page.goto("/plans");

    // Edit the plan through the GUI and confirm the change persists.
    await page.getByRole("listitem").filter({ hasText: `${tag} plan` }).getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit Program" })).toBeVisible();
    await expect(page.getByLabel("Plan name")).toHaveValue(`${tag} plan`);
    const editRows = page.locator("#plan-exercises-list > div");
    await editRows.nth(0).getByLabel("Target weight (kg)").fill("105");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Workout Plans" })).toBeVisible();

    const updated = await request.get(`/api/v1/plans/${planId}`);
    expect(updated.status()).toBe(200);
    /** @type {{exercises: Array<{exercise_name: string, target_weight_kg: number | null}>}} */
    const updatedBody = await updated.json();
    const updatedSquat = updatedBody.exercises.find((ex) => ex.exercise_name === `${tag} Squat`);
    expect(updatedSquat?.target_weight_kg).toBe(105);

    // Delete through the GUI and prove it is gone.
    await page.getByRole("listitem").filter({ hasText: `${tag} plan` }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog", { name: "Delete plan" }).getByRole("button", { name: "Delete" }).click();
    await expect(
      page.locator("#plans-list").getByText(`${tag} plan`, { exact: true })
    ).toBeHidden();
    const afterDelete = await request.get(`/api/v1/plans/${planId}`);
    expect(afterDelete.status()).toBe(404);
    planId = undefined;
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
