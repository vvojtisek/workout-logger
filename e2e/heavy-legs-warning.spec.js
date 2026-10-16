import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";
import { clickAndAwaitWrite } from "./support/writes.js";

/** @param {number} year @param {number} month @param {number} day */
function isoDate(year, month, day) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

test("flags heavy legs the day before a game and fixes it by moving or swapping", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `heavy-legs-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:heavy-legs]`;
  /** @type {string[]} */
  const planIds = [];
  /** @type {string[]} */
  const scheduledIds = [];
  /** @type {string | undefined} */
  let eventId;

  // The calendar opens on the current UTC month. Put a weekly game on the
  // weekday of the 11th and heavy legs on the 10th and on the 17th.
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const tenth = isoDate(year, month, 10);
  const seventeenth = isoDate(year, month, 17);
  const ninth = isoDate(year, month, 9);
  const gameWeekday = (new Date(Date.UTC(year, month, 11)).getUTCDay() + 6) % 7;

  /** @param {string} name @param {string} exercise */
  async function addPlan(name, exercise) {
    const response = await request.post("/api/v1/plans", {
      data: {
        name,
        exercises: [{ exercise_name: exercise, target_sets: 3, target_reps_min: 5, target_reps_max: 6 }],
      },
    });
    expect(response.status()).toBe(201);
    const id = (await response.json()).id;
    planIds.push(id);
    return id;
  }

  /** @param {string} planId @param {string} day */
  async function schedule(planId, day) {
    const response = await request.post("/api/v1/scheduled-workouts", {
      data: { workout_plan_id: planId, scheduled_date: day },
    });
    expect(response.status()).toBe(201);
    const id = (await response.json()).id;
    scheduledIds.push(id);
    return id;
  }

  try {
    page.setDefaultTimeout(5_000);
    const event = await request.post("/api/v1/load-events", {
      data: {
        name: `${tag} game`,
        kind: "game",
        weekday: gameWeekday,
        start_time: "19:30",
        season_start: isoDate(year, month, 1),
        season_end: isoDate(year, month + 2, 1),
      },
    });
    expect(event.status()).toBe(201);
    eventId = (await event.json()).id;
    const legs = await addPlan(`${tag} legs`, "Front squat");
    const upper = await addPlan(`${tag} upper`, "Bench press");
    const moveMe = await schedule(legs, tenth);
    const swapMe = await schedule(legs, seventeenth);

    await page.goto("/");
    await openPage(page, "Calendar");
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    const flagged = page.getByRole("button", { name: `${tag} legs, heavy legs before hockey` });
    await expect(flagged).toHaveCount(2);

    // Move the first one to the free day before.
    await flagged.first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("load-warning")).toContainText(
      `Heavy leg work (Front squat) the day before ${tag} game at 19:30.`,
    );
    await clickAndAwaitWrite(
      page,
      dialog.getByRole("button", { name: `Move to ${ninth}` }),
      "PATCH",
    );
    await expect(flagged).toHaveCount(1);
    expect((await (await request.get(`/api/v1/scheduled-workouts/${moveMe}`)).json()).scheduled_date).toBe(
      ninth,
    );

    // Swap the second one to the upper-body plan.
    await flagged.click();
    await dialog.getByLabel("Plan to swap in").selectOption(upper);
    await clickAndAwaitWrite(page, dialog.getByRole("button", { name: "Swap plan" }), "PATCH");
    await expect(flagged).toHaveCount(0);
    await expect(page.getByTestId("calendar-load-warning")).toHaveCount(0);
    const swapped = await (await request.get(`/api/v1/scheduled-workouts/${swapMe}`)).json();
    expect(swapped).toMatchObject({ workout_plan_id: upper, scheduled_date: seventeenth });
  } finally {
    for (const id of scheduledIds) await request.delete(`/api/v1/scheduled-workouts/${id}`);
    for (const id of planIds) await request.delete(`/api/v1/plans/${id}`);
    if (eventId) await request.delete(`/api/v1/load-events/${eventId}`);
  }
});
