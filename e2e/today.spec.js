import { expect, test } from "@playwright/test";

import { isDesktop, openLogSheet } from "./support/navigation.js";
import { clickAndAwaitWrite } from "./support/writes.js";

// The browser's clock is pinned to an evening in a season nobody else uses,
// so "today" on the phone is a day this spec owns: Tuesday 04/03/2031, 21:00.
const NOW = new Date(2031, 2, 4, 21, 0);
const TODAY = "2031-03-04";

test("confirms hockey, sleep and a repeat meal in one tap each on the phone's Today screen", async ({
  page,
  request,
}) => {
  test.skip(isDesktop(page), "Today is the phone's home screen");
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `today-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:today]`;
  const food = `${tag} oats`;
  /** @type {string | undefined} */ let eventId;
  /** @type {string | undefined} */ let planId;
  /** @type {string | undefined} */ let scheduledId;
  /** @type {string | undefined} */ let sessionId;

  /** @returns {Promise<Array<{id: string, consumed_at: string, meal_type: string, items: Array<{food_name_snapshot: string, quantity: number, energy_kcal_snapshot: number}>}>>} */
  async function ourMeals() {
    const body = await (await request.get("/api/v1/meal-entries?limit=100")).json();
    return body.items.filter((/** @type {{items: Array<{food_name_snapshot: string}>}} */ entry) =>
      entry.items.some((item) => item.food_name_snapshot === food),
    );
  }

  /** @returns {Promise<Array<{id: string, sleep_date: string, sleep_end: string, quality_score: number | null}>>} */
  async function sleepToday() {
    const body = await (await request.get("/api/v1/sleep-entries?limit=100")).json();
    return body.items.filter((/** @type {{sleep_date: string}} */ entry) => entry.sleep_date === TODAY);
  }

  /** @returns {Promise<Array<{id: string, activity_type: string | null, performed_at: string, total_time_minutes: number, overall_feeling: number, notes: string | null}>>} */
  async function ourHockey() {
    const body = await (await request.get("/api/v1/logs?limit=100")).json();
    return body.items.filter((/** @type {{notes: string | null}} */ log) => log.notes === `${tag} practice`);
  }

  try {
    page.setDefaultTimeout(5_000);
    await page.clock.setFixedTime(NOW);

    const event = await request.post("/api/v1/load-events", {
      data: {
        name: `${tag} practice`,
        kind: "practice",
        weekday: 1,
        start_time: "19:00",
        duration_minutes: 60,
        season_start: "2030-09-01",
        season_end: "2031-03-31",
      },
    });
    expect(event.status()).toBe(201);
    eventId = (await event.json()).id;

    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} full body`,
        exercises: [{ exercise_name: `${tag} Goblet squat`, target_sets: 2, target_reps_min: 8, target_reps_max: 12 }],
      },
    });
    expect(plan.status()).toBe(201);
    planId = (await plan.json()).id;
    const scheduled = await request.post("/api/v1/scheduled-workouts", {
      data: { workout_plan_id: planId, scheduled_date: TODAY },
    });
    expect(scheduled.status()).toBe(201);
    scheduledId = (await scheduled.json()).id;

    // Yesterday's breakfast, so there is a meal to repeat.
    const breakfast = await request.post("/api/v1/meal-entries", {
      data: {
        consumed_at: new Date(2031, 2, 3, 7, 0).toISOString(),
        meal_type: "breakfast",
        notes: tag,
        items: [
          {
            food_id: null,
            quantity: 60,
            unit: "g",
            food_name_snapshot: food,
            energy_kcal: 230,
            protein_g: 8,
            carbohydrate_g: 40,
            fat_g: 4,
          },
        ],
      },
    });
    expect(breakfast.status()).toBe(201);
    expect(await sleepToday()).toEqual([]);

    // The phone opens on Today, dated dd/MM/yyyy with a Monday-based week.
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { name: "Tue 04/03/2031" })).toBeVisible();
    await expect(page.getByText("Week 10")).toBeVisible();

    // Hockey from the sport schedule: one tap on how it felt logs it.
    const hockey = page.getByTestId("today-hockey");
    await expect(hockey.getByText(`${tag} practice`)).toBeVisible();
    await clickAndAwaitWrite(
      page,
      hockey.getByRole("group", { name: "How hockey felt" }).getByRole("button", { name: "4 Good" }),
      "POST",
    );
    await expect(hockey).toHaveCount(0);
    const played = await ourHockey();
    expect(played).toHaveLength(1);
    expect(played[0]).toMatchObject({ activity_type: "ice_hockey", total_time_minutes: 60, overall_feeling: 4 });
    expect(new Date(played[0].performed_at).getTime()).toBe(new Date(2031, 2, 4, 19, 0).getTime());

    // Sleep: usual times prefilled, nudge one, one tap on how rested saves.
    const sleep = page.getByTestId("today-sleep");
    await expect(sleep.locator("#today-bed")).toHaveText("23:00");
    await expect(sleep.locator("#today-wake")).toHaveText("07:00");
    await sleep.getByRole("button", { name: "Woke up 15 minutes later" }).click();
    await expect(sleep.locator("#today-wake")).toHaveText("07:15");
    await clickAndAwaitWrite(
      page,
      sleep.getByRole("group", { name: "How rested" }).getByRole("button", { name: "4 Good" }),
      "POST",
    );
    await expect(sleep.getByText(/8 h 15 min · Quality 4\/5 \(Good\)/)).toBeVisible();
    const slept = await sleepToday();
    expect(slept).toHaveLength(1);
    expect(slept[0].quality_score).toBe(4);
    expect(new Date(slept[0].sleep_end).getTime()).toBe(new Date(2031, 2, 4, 7, 15).getTime());

    // Food: yesterday's meal comes back as a chip; one tap logs it as dinner.
    const meals = page.getByTestId("today-food").getByRole("group", { name: "Repeat a meal" });
    await clickAndAwaitWrite(page, meals.getByRole("button", { name: new RegExp(food.replace(/[[\]]/g, "\\$&")) }), "POST");
    const logged = await ourMeals();
    expect(logged).toHaveLength(2);
    const repeat = logged.find((entry) => entry.meal_type === "dinner");
    expect(repeat?.items).toMatchObject([{ food_name_snapshot: food, quantity: 60, energy_kcal_snapshot: 230 }]);

    // The Log button opens the quick-entry sheet.
    await openLogSheet(page);
    const sheet = page.getByRole("dialog", { name: "Log" });
    for (const entry of ["Food", "Sleep", "Activity", "Weight", "Start a workout", "Past workout"]) {
      await expect(sheet.getByRole("link", { name: entry, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // The coach card starts today's scheduled session.
    const coach = page.getByTestId("today-coach");
    await expect(coach.getByText(`${tag} full body`)).toBeVisible();
    await coach.getByRole("button", { name: "Start session" }).click();
    await expect(page.getByRole("heading", { name: `${tag} Goblet squat` })).toBeVisible();
    const active = await (await request.get("/api/v1/workout-sessions/active")).json();
    sessionId = active.id;
    expect(active.source_plan_id).toBe(planId);
  } finally {
    if (sessionId) await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    for (const log of await ourHockey()) await request.delete(`/api/v1/logs/${log.id}`);
    for (const entry of await sleepToday()) await request.delete(`/api/v1/sleep-entries/${entry.id}`);
    for (const entry of await ourMeals()) await request.delete(`/api/v1/meal-entries/${entry.id}`);
    if (scheduledId) await request.delete(`/api/v1/scheduled-workouts/${scheduledId}`);
    if (planId) await request.delete(`/api/v1/plans/${planId}`);
    if (eventId) await request.delete(`/api/v1/load-events/${eventId}`);

    expect(await ourHockey()).toEqual([]);
    expect(await sleepToday()).toEqual([]);
    expect(await ourMeals()).toEqual([]);
    if (planId) expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    if (eventId) expect((await request.get(`/api/v1/load-events/${eventId}`)).status()).toBe(404);
  }
});
