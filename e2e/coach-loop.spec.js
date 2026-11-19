import { expect, test } from "@playwright/test";

import { isDesktop } from "./support/navigation.js";
import { clickAndAwaitWrite } from "./support/writes.js";

// The AI coach loop end to end: a meal plan written over the API renders in
// Kitchen & Store, the Today quick-log buttons log in one tap, and a
// scheduled workout opens pre-filled from history scaled by readiness.

/** The device's calendar day, as the app computes "today". */
function localToday() {
  const now = new Date();
  const pad = (/** @type {number} */ value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** @param {string} tag @param {string} date */
function dayPlan(tag, date) {
  return {
    plan_date: date,
    energy_target_kcal: 2300,
    protein_target_g: 150,
    fiber_target_g: 35,
    notes: `${tag} plan`,
    meals: [
      {
        meal_type: "lunch",
        name: `${tag} Turkey rice bowl`,
        energy_kcal: 650,
        protein_g: 50,
        carbohydrate_g: 75,
        fat_g: 14,
        fiber_g: 6,
        prep_steps: ["Rinse and cook the rice for 12 min", "Pan-fry the turkey, 4 min a side"],
        ingredients: [
          { name: `${tag} Turkey breast`, quantity: 180, unit: "g", note: "raw weight" },
          { name: `${tag} Rice`, quantity: 90, unit: "g", note: "dry" },
        ],
      },
    ],
  };
}

test("a meal plan sent over the API renders in Kitchen & Store with working checkboxes", async ({
  page,
  request,
}) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || `kitchen-${Date.now()}`}:kitchen]`;
  const today = localToday();
  let written = false;
  /** @type {string[]} */
  let supplementIds = [];
  try {
    page.setDefaultTimeout(5_000);
    const day = dayPlan(tag, today);
    const upsert = await request.put("/api/v1/coach/nutrition-plan", {
      data: {
        days: [day],
        supplement_stack: [{ name: `${tag} Creatine`, dose: 5, unit: "g", timing: "morning" }],
      },
    });
    expect(upsert.status(), await upsert.text()).toBe(200);
    written = true;
    supplementIds = (await upsert.json()).supplements.map((/** @type {{id: string}} */ item) => item.id);

    await page.goto("/kitchen");
    const meal = page.getByTestId("kitchen-meal").filter({ hasText: `${tag} Turkey rice bowl` });
    await expect(meal).toBeVisible();
    await expect(meal.getByText("180 g")).toBeVisible();
    await expect(meal.getByText("Pan-fry the turkey, 4 min a side")).toBeVisible();
    await expect(page.getByTestId("kitchen-targets")).toContainText("150");

    // Supplement reminder: tick it taken.
    const creatine = page.getByTestId("kitchen-supplement").filter({ hasText: `${tag} Creatine` });
    await clickAndAwaitWrite(page, creatine.getByRole("checkbox"), "PUT");
    await expect(creatine).toHaveAttribute("data-checked", "true");

    // Kitchen checklist: the ticked ingredient is struck through and saved.
    const turkey = meal.getByTestId("kitchen-ingredient").filter({ hasText: `${tag} Turkey breast` });
    await clickAndAwaitWrite(page, turkey.getByRole("checkbox"), "PATCH");
    await expect(turkey).toHaveAttribute("data-checked", "true");
    await expect(turkey.locator(".line-through")).toBeVisible();
    const saved = await (await request.get(`/api/v1/meal-plans/${today}`)).json();
    const ingredient = saved.meals[0].ingredients.find(
      (/** @type {{name: string}} */ item) => item.name === `${tag} Turkey breast`,
    );
    expect(ingredient.prepared).toBe(true);

    // One tap logs the meal as eaten.
    await clickAndAwaitWrite(page, meal.getByRole("button", { name: "Logged as eaten" }), "POST");
    await expect(meal.getByTestId("kitchen-eaten")).toBeVisible();
    const eaten = await (await request.get(`/api/v1/meal-plans/${today}`)).json();
    expect(eaten.meals[0].eaten_meal_entry_id).not.toBeNull();

    // Store: the shopping list, persistent across a reload.
    await page.getByRole("tab", { name: "Store" }).click();
    const rice = page.getByTestId("store-item").filter({ hasText: `${tag} Rice` });
    await expect(rice).toContainText("90 g");
    await clickAndAwaitWrite(page, rice.getByRole("checkbox"), "PATCH");
    await expect(rice).toHaveAttribute("data-checked", "true");
    await page.reload();
    await page.getByRole("tab", { name: "Store" }).click();
    await expect(page.getByTestId("store-item").filter({ hasText: `${tag} Rice` })).toHaveAttribute(
      "data-checked",
      "true",
    );

    // No horizontal scrolling, and the checkboxes' rows are full-size targets.
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wide).toBe(0);
    const box = await page.getByTestId("store-item").first().boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  } finally {
    if (written) {
      const current = await (await request.get(`/api/v1/meal-plans/${today}`)).json();
      for (const meal of current.meals ?? []) {
        if (meal.eaten_meal_entry_id) await request.delete(`/api/v1/meal-plans/meals/${meal.id}/eaten`);
      }
      for (const id of supplementIds) expect((await request.delete(`/api/v1/supplements/${id}`)).status()).toBe(204);
      expect((await request.delete(`/api/v1/meal-plans/${today}`)).status()).toBe(204);
    }
  }
});

test("Swim + sauna and hockey log in one tap each and update Today's summary", async ({ page, request }) => {
  test.skip(isDesktop(page), "The quick-log bar is the phone's home screen");
  const startedAt = Date.now();
  /** @returns {Promise<Array<{id: string, source_plan_name: string | null, total_time_minutes: number, laps: number | null, sauna_rounds: number | null}>>} */
  async function ourLogs() {
    const body = await (await request.get("/api/v1/logs?limit=100")).json();
    return body.items.filter(
      (/** @type {{performed_at: string, source_plan_name: string | null}} */ log) =>
        Date.parse(log.performed_at) >= startedAt - 1000 && ["Swim + sauna", "Ice hockey"].includes(log.source_plan_name ?? ""),
    );
  }
  try {
    page.setDefaultTimeout(5_000);
    await page.goto("/today");
    const done = page.getByTestId("today-done");
    const before = await done.getByTestId("today-done-item").count();

    const swim = page.getByTestId("quick-swim-sauna");
    const swimBox = await swim.boundingBox();
    expect(swimBox?.height).toBeGreaterThanOrEqual(44);
    await clickAndAwaitWrite(page, swim, "POST");
    const entries = done.locator("details");
    await expect(entries).not.toHaveAttribute("open", "");
    await entries.locator("summary").click();
    await expect(done.getByTestId("today-done-item").filter({ hasText: "Swim + sauna" }).first()).toContainText(
      "30 min · 30 laps · 3 sauna",
    );
    await expect(page.getByRole("button", { name: "Edit details" })).toBeVisible();

    await clickAndAwaitWrite(page, page.getByTestId("quick-hockey"), "POST");
    await expect(done.getByTestId("today-done-item").filter({ hasText: "Ice hockey" }).first()).toBeVisible();
    await expect(done.getByTestId("today-done-item")).toHaveCount(before + 2);

    const logs = await ourLogs();
    expect(logs.map((log) => log.source_plan_name).sort()).toEqual(["Ice hockey", "Swim + sauna"]);
    const saved = logs.find((log) => log.source_plan_name === "Swim + sauna");
    expect(saved).toMatchObject({ total_time_minutes: 30, laps: 30, sauna_rounds: 3 });

    // The toast's Edit details opens that log's editor.
    await page.getByRole("button", { name: "Edit details" }).last().click();
    await expect(page.getByRole("heading", { name: "Edit Workout" })).toBeVisible();
    await expect(page.locator("#edit-total-time")).toBeVisible();
  } finally {
    for (const log of await ourLogs()) await request.delete(`/api/v1/logs/${log.id}`);
    expect(await ourLogs()).toEqual([]);
  }
});

test("a scheduled gym workout opens pre-filled from history and scaled by today's check-in", async ({
  page,
  request,
}) => {
  test.skip(isDesktop(page), "The check-in and HUD are the phone layout");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `coach-${Date.now()}`}:coach]`;
  const today = localToday();
  const exercise = `${tag} Romanian deadlift`;
  const startedAt = Date.now();
  /** @type {string[]} */
  const cleanup = [];
  /** @type {string | undefined} */
  let sessionId;
  try {
    page.setDefaultTimeout(5_000);
    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} lower`,
        exercises: [{ exercise_name: exercise, target_sets: 3, target_reps_min: 8, target_reps_max: 12 }],
      },
    });
    expect(plan.status()).toBe(201);
    const planId = (await plan.json()).id;
    cleanup.push(`/api/v1/plans/${planId}`);

    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const history = await request.post("/api/v1/logs", {
      data: {
        source_plan_id: planId,
        performed_at: twoDaysAgo,
        total_time_minutes: 30,
        overall_feeling: 4,
        notes: tag,
        exercises: [{ exercise_name: exercise, sets_count: 3, weight_kg: 70, reps_per_set: [8, 8, 8] }],
      },
    });
    expect(history.status()).toBe(201);
    cleanup.unshift(`/api/v1/logs/${(await history.json()).id}`);

    const scheduled = await request.post("/api/v1/scheduled-workouts", {
      data: { workout_plan_id: planId, scheduled_date: today },
    });
    expect(scheduled.status()).toBe(201);
    cleanup.unshift(`/api/v1/scheduled-workouts/${(await scheduled.json()).id}`);

    // Check in through the Today sheet: very sore and low on energy.
    await page.goto("/today");
    await page.getByTestId("quick-check-in").click();
    const sheet = page.getByRole("dialog", { name: "How do you feel?" });
    await sheet.getByLabel("Soreness").fill("8");
    await expect(sheet.getByText("8 · Very sore")).toBeVisible();
    await sheet.getByRole("button", { name: "Hamstrings" }).click();
    await sheet.getByLabel("Energy").fill("3");
    await clickAndAwaitWrite(page, sheet.getByRole("button", { name: "Save check-in" }), "POST");
    await expect(page.getByTestId("today-readiness")).toContainText("/100");

    await page
      .getByTestId("today-coach")
      .getByRole("button", { name: "Start session" })
      .click();
    await expect(page.getByRole("heading", { name: exercise })).toBeVisible();
    const active = await (await request.get("/api/v1/workout-sessions/active")).json();
    sessionId = active.id;
    const prescribed = active.exercises[0];
    expect(prescribed.readiness_factor).toBeLessThan(1);
    expect(prescribed.suggested_weight_kg).toBeLessThan(70);

    await expect(page.locator("#hud-last-session")).toHaveText("Last: 3x8 @ 70 kg");
    await expect(page.locator("#hud-readiness")).toHaveText(/^Adjusted -\d+% for .+/);
    await expect(page.getByLabel("Weight (kg)")).toHaveValue(String(prescribed.suggested_weight_kg));
    await expect(page.getByLabel("Repetitions")).toHaveValue(String(prescribed.suggested_reps));

    // Taking the suggestion is one tap.
    await page.getByRole("button", { name: "Complete set & start rest" }).click();
    await expect
      .poll(async () => {
        const latest = await (await request.get(`/api/v1/workout-sessions/${sessionId}`)).json();
        return latest.exercises[0].set_entries.map(
          (/** @type {{weight_kg: number, reps: number}} */ entry) => [entry.weight_kg, entry.reps],
        );
      })
      .toEqual([[prescribed.suggested_weight_kg, prescribed.suggested_reps]]);
  } finally {
    if (sessionId) await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    const checkIns = await (await request.get(`/api/v1/readiness-logs?start=${today}&end=${today}`)).json();
    for (const log of checkIns.items ?? []) {
      if (Date.parse(log.logged_at) >= startedAt - 1000) await request.delete(`/api/v1/readiness-logs/${log.id}`);
    }
    for (const path of cleanup) await request.delete(path);
  }
});
