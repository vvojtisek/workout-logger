import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";

test("starting at a location flags missing equipment, swaps in one tap, and filters the catalogue", async ({
  page,
  request,
}) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || `loc-${Date.now()}`}:train-at]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let locationId;
  /** @type {string | undefined} */
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    // A hotel gym with dumbbells only; the plan's back squat needs a barbell and rack.
    const location = await request.post("/api/v1/locations", {
      data: { name: `${tag} Hotel`, kind: "travel", equipment: ["dumbbell"] },
    });
    expect(location.status()).toBe(201);
    locationId = (await location.json()).id;
    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        exercises: [
          { exercise_name: "Back squat", target_sets: 2, target_reps_min: 6, target_reps_max: 8 },
          { exercise_name: "Push-up", target_sets: 2, target_reps_min: 8, target_reps_max: 12 },
        ],
      },
    });
    expect(plan.status()).toBe(201);
    planId = (await plan.json()).id;

    await page.goto("/");
    await openPage(page, "Plans");
    await page.getByLabel("Training at").selectOption({ label: `${tag} Hotel` });
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} plan` })
      .getByRole("button", { name: "Start workout" })
      .click();

    const dialog = page.getByRole("dialog", { name: `Training at ${tag} Hotel` });
    await expect(dialog).toBeVisible();
    const flagged = dialog.getByRole("listitem");
    await expect(flagged).toHaveCount(1);
    await expect(flagged).toContainText("Back squat");
    await expect(flagged).toContainText("Needs Barbell + Rack");
    sessionId = (await (await request.get("/api/v1/workout-sessions/active")).json()).id;
    const check = await (await request.get(`/api/v1/workout-sessions/${sessionId}/location-check`)).json();
    const firstSwap = check.items[0].swaps[0].exercise_name;
    expect(firstSwap).toBeTruthy();

    await flagged.getByRole("button", { name: firstSwap, exact: true }).click();
    await expect(dialog.getByText("Everything in this workout works here.")).toBeVisible();
    await dialog.getByRole("button", { name: "Start workout" }).click();
    await expect(dialog).toBeHidden();

    const session = await (await request.get(`/api/v1/workout-sessions/${sessionId}`)).json();
    expect(session.location_id).toBe(locationId);
    expect(session.exercises.map((/** @type {{exercise_name: string}} */ e) => e.exercise_name)).toEqual([
      firstSwap,
      "Push-up",
    ]);

    // The catalogue can show only what the hotel can host.
    await page.request.delete(`/api/v1/workout-sessions/${sessionId}`);
    sessionId = undefined;
    await page.goto("/exercises");
    await page.getByLabel("Available at").selectOption({ label: `${tag} Hotel` });
    await page.getByLabel("Search exercises").fill("squat");
    const list = page.locator("#exercises-list");
    await expect(list.getByText("Goblet squat", { exact: true })).toBeVisible();
    await expect(list.getByText("Back squat", { exact: true })).toBeHidden();
  } finally {
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    }
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
    if (locationId) {
      await request.delete(`/api/v1/locations/${locationId}`);
      expect((await request.get(`/api/v1/locations/${locationId}`)).status()).toBe(404);
    }
  }
});
