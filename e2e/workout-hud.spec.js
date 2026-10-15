import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

/**
 * Drags a finger across the HUD through Chromium's touch input, so the swipe
 * goes through real touchstart/touchend events.
 * @param {import("@playwright/test").Page} page
 * @param {number} fromX @param {number} toX @param {number} y
 */
async function swipe(page, fromX, toX, y) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: fromX, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: (fromX + toX) / 2, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: toX, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

test("logs a superset workout one-handed on the phone HUD", async ({
  page,
  request,
}) => {
  test.skip(isDesktop(page), "The HUD is the phone layout of the live workout");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `hud-${Date.now()}`}:hud]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let sessionId;
  /** @type {string | undefined} */
  let logId;

  try {
    page.setDefaultTimeout(5_000);
    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        description: `${tag} HUD fixture`,
        exercises: [
          {
            exercise_name: `${tag} Squat`,
            target_sets: 2,
            target_reps_min: 5,
            target_reps_max: 8,
            target_weight_kg: 80,
            rest_time_seconds: 30,
          },
          {
            exercise_name: `${tag} Row`,
            target_sets: 1,
            target_reps_min: 8,
            target_reps_max: 12,
            target_weight_kg: 40,
            rest_time_seconds: 30,
            group_key: `${tag} superset`,
            group_order: 0,
          },
          {
            exercise_name: `${tag} Press`,
            target_sets: 1,
            target_reps_min: 8,
            target_reps_max: 12,
            target_weight_kg: 20,
            rest_time_seconds: 30,
            group_key: `${tag} superset`,
            group_order: 1,
          },
        ],
      },
    });
    expect(planResponse.status()).toBe(201);
    planId = (await planResponse.json()).id;

    await page.goto("/");
    await openPage(page, "Plans");
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} plan` })
      .getByRole("button", { name: "Start workout" })
      .click();
    await expect(
      page.getByRole("heading", { name: `${tag} Squat` }),
    ).toBeVisible();
    sessionId = (
      await (await request.get("/api/v1/workout-sessions/active")).json()
    ).id;

    // Full screen: no app chrome, nothing scrolls, nothing spills sideways.
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toHaveCount(0);
    const fits = await page.evaluate(() => ({
      tall: document.documentElement.scrollHeight - window.innerHeight,
      wide:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    }));
    expect(fits).toEqual({ tall: 0, wide: 0 });
    await expect(page.locator("#hud-position")).toHaveText(
      "EXERCISE 1 OF 3 • SET 1 OF 2",
    );
    await expect(page.locator("#active-elapsed")).toHaveText(
      /^\d{2}:\d{2}:\d{2}$/,
    );

    // Steppers and RIR pills.
    const weight = page.getByLabel("Weight (kg)");
    await expect(weight).toHaveValue("80");
    await page.getByRole("button", { name: "+2.5" }).click();
    await expect(weight).toHaveValue("82.5");
    await page.getByLabel("Repetitions").fill("6");
    const rir = page.getByRole("radiogroup", { name: "RIR" });
    await rir.getByRole("radio", { name: "4+" }).click();
    await expect(rir.getByRole("radio", { name: "4+" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await rir.getByRole("radio", { name: "2" }).click();
    await expect(rir.getByRole("radio", { name: "4+" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    const complete = page.getByRole("button", {
      name: "Complete set & start rest",
    });
    const ctaBox = await complete.boundingBox();
    expect(ctaBox?.height).toBe(54);
    for (const label of ["+2.5", "−2.5"]) {
      const box = await page.getByRole("button", { name: label }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    // Completing turns the action into the rest bar and moves to set 2 with
    // the values just logged.
    await complete.click();
    const timer = page.getByRole("timer");
    await expect(timer).toHaveText(/^RESTING — 00:(29|30)$/);
    await expect(complete).toHaveCount(0);
    await expect(page.locator("#hud-position")).toHaveText(
      "EXERCISE 1 OF 3 • SET 2 OF 2",
    );
    await expect(weight).toHaveValue("82.5");
    await expect(page.getByLabel("Repetitions")).toHaveValue("6");
    await expect(rir.getByRole("radio", { name: "2" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    let body = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    expect(body.exercises[0].set_entries[0]).toMatchObject({
      set_number: 1,
      weight_kg: 82.5,
      reps: 6,
      rir: 2,
      state: "completed",
    });
    const originalEnd = new Date(body.rest_ends_at).getTime();
    await page.getByRole("button", { name: "+15 seconds" }).click();
    await expect
      .poll(async () => {
        const latest = await (
          await request.get(`/api/v1/workout-sessions/${sessionId}`)
        ).json();
        return new Date(latest.rest_ends_at).getTime() - originalEnd;
      })
      .toBe(15_000);
    await page.getByRole("button", { name: "Skip Rest" }).click();
    await expect(complete).toBeVisible();
    await expect(timer).toHaveCount(0);

    // Finishing the exercise moves on to the superset by itself.
    await complete.click();
    await expect(
      page.getByRole("heading", { name: `${tag} Row` }),
    ).toBeVisible();
    await expect(page.locator("#hud-position")).toHaveText(
      "EXERCISE 2 OF 3 • SET 1 OF 1",
    );
    await expect(page.getByText("A1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Skip Rest" }).click();

    // Pager: back to the saved set, then forward again.
    await page.getByRole("button", { name: "← Prev Set" }).click();
    await expect(page.locator("#hud-position")).toHaveText(
      "EXERCISE 1 OF 3 • SET 2 OF 2",
    );
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(weight).toBeDisabled();
    await page.getByRole("button", { name: "Next Exercise →" }).click();
    await expect(
      page.getByRole("heading", { name: `${tag} Row` }),
    ).toBeVisible();

    // Inside a superset the next set is the partner exercise, not set 2 of Row.
    await page
      .getByRole("button", { name: "Complete set & start rest" })
      .click();
    await expect(
      page.getByRole("heading", { name: `${tag} Press` }),
    ).toBeVisible();
    await expect(page.getByText("A2", { exact: true })).toBeVisible();

    // A right swipe goes back an exercise, and the server keeps that focus.
    await swipe(page, 60, 300, 400);
    await expect(
      page.getByRole("heading", { name: `${tag} Row` }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: `${tag} Row` }),
    ).toBeVisible();
    await swipe(page, 300, 60, 400);
    await expect(
      page.getByRole("heading", { name: `${tag} Press` }),
    ).toBeVisible();

    // Minimizing keeps the session; the Train tab returns to it.
    await page.getByRole("button", { name: "Minimize workout" }).click();
    await expect(page).toHaveURL(/\/plans$/);
    await expect(page.getByTestId("live-workout-badge")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Train" })
      .click();
    await expect(
      page.getByRole("heading", { name: `${tag} Press` }),
    ).toBeVisible();

    // Finishing early asks first.
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Finish incomplete workout?",
    });
    await dialog.getByRole("button", { name: "Finish workout" }).click();
    await expect(
      page.getByRole("heading", { name: "Workout History" }),
    ).toBeVisible();
    body = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    expect(body.status).toBe("completed");
    logId = body.workout_log_id;
  } finally {
    if (!sessionId && planId) {
      const active = await request.get("/api/v1/workout-sessions/active");
      if (active.status() === 200) sessionId = (await active.json()).id;
    }
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    }
    if (planId) {
      const history = await request.get(
        `/api/v1/logs?source_plan_id=${planId}`,
      );
      for (const log of (await history.json()).items)
        await request.delete(`/api/v1/logs/${log.id}`);
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
    if (logId)
      expect((await request.get(`/api/v1/logs/${logId}`)).status()).toBe(404);
  }
});
