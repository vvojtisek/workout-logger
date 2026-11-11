import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";
import { readWorkoutStorage } from "./support/workout.js";

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

    // Minimizing keeps the session; Today offers the way back to it.
    await page.getByRole("button", { name: "Minimize workout" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByTestId("live-workout-badge")).toBeVisible();
    await page.getByRole("button", { name: "Resume workout" }).click();
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

test("advances the phone HUD offline and replays the original rest deadline", async ({
  context, page, request,
}) => {
  test.skip(isDesktop(page), "The queued workout progression is shown on the phone HUD");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `hud-${Date.now()}`}:hud-offline]`;
  let planId;
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        exercises: [{
          exercise_name: `${tag} Press`,
          target_sets: 3,
          target_reps_min: 8,
          target_reps_max: 10,
          target_weight_kg: 20,
          rest_time_seconds: 30,
        }],
      },
    });
    expect(plan.status()).toBe(201);
    planId = (await plan.json()).id;
    const started = await request.post("/api/v1/workout-sessions", {
      data: { source_plan_id: planId },
    });
    expect(started.status()).toBe(201);
    sessionId = (await started.json()).id;
    await page.goto("/workout");

    const position = page.locator("#hud-position");
    const sync = page.locator("#active-sync-status");
    const complete = page.getByRole("button", { name: "Complete set & start rest" });
    const timer = page.getByRole("timer");
    /** @type {string[]} */
    const serverOnlyRequests = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && /\/(focus|rest)$/.test(request.url())) {
        serverOnlyRequests.push(request.url());
      }
    });
    await expect(position).toHaveText("EXERCISE 1 OF 1 • SET 1 OF 3");
    await expect(complete).toBeEnabled();
    await context.setOffline(true);
    await page.getByRole("button", { name: "+2.5" }).click();
    await complete.click();
    await expect(sync).toHaveText("Pending synchronization");
    await expect(position).toHaveText("EXERCISE 1 OF 1 • SET 2 OF 3");
    await expect(timer).toHaveText(/^RESTING — 00:(29|30)$/);
    await expect(page.getByLabel("Weight (kg)")).toHaveValue("22.5");
    await page.getByRole("button", { name: "← Prev Set" }).click();
    await expect(page.getByText("Set saved on this device")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Next Set →" }).click();

    await page.getByRole("button", { name: "+15 seconds" }).click();
    await expect(timer).toHaveText(/^RESTING — 00:4[2-5]$/);
    await page.getByRole("button", { name: "Skip Rest" }).click();
    await expect(complete).toBeVisible();
    await complete.click();
    await expect(position).toHaveText("EXERCISE 1 OF 1 • SET 3 OF 3");
    await expect(timer).toHaveText(/^RESTING — 00:(29|30)$/);
    const offline = await request.get(`/api/v1/workout-sessions/${sessionId}`);
    expect(offline.status()).toBe(200);
    expect((await offline.json()).exercises[0].set_entries).toHaveLength(0);
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(page.getByText("Synchronize queued sets before finishing.")).toBeVisible();
    expect(serverOnlyRequests).toEqual([]);

    const queued = await readWorkoutStorage(page, "workout_logger_active_set_queue");
    if (typeof queued !== "string") throw new Error("The pending sets must be in IndexedDB");
    /** @type {import("../frontend/src/lib/active-workout-state").SetOperation[]} */
    const operations = JSON.parse(queued);
    expect(operations.map((operation) => operation.payload.set_number)).toEqual([1, 2]);
    expect(operations[0].payload.client_rest_seconds).toBe(0);
    const secondTap = Date.parse(operations[1].payload.client_completed_at ?? "");
    await context.setOffline(false);
    await expect(sync).toHaveText("Synchronized");
    await expect(position).toHaveText("EXERCISE 1 OF 1 • SET 3 OF 3");

    const replayed = await request.get(`/api/v1/workout-sessions/${sessionId}`);
    expect(replayed.status()).toBe(200);
    const body = await replayed.json();
    expect(body.exercises[0].set_entries).toMatchObject([
      { set_number: 1, weight_kg: 22.5, client_operation_id: operations[0].client_operation_id },
      { set_number: 2, weight_kg: 22.5, client_operation_id: operations[1].client_operation_id },
    ]);
    expect(Date.parse(body.rest_ends_at)).toBe(secondTap + 30_000);
  } finally {
    await context.setOffline(false);
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
      expect((await request.get(`/api/v1/workout-sessions/${sessionId}`)).status()).toBe(404);
    }
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});

test("recovers the phone workout offline and verifies the account before replay", async ({
  context, page, request,
}) => {
  test.skip(isDesktop(page), "The offline resume journey uses the phone HUD");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `hud-${Date.now()}`}:offline-resume]`;
  let planId;
  let sessionId;
  let replayRequests = 0;

  try {
    page.setDefaultTimeout(5_000);
    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        exercises: [{
          exercise_name: `${tag} Row`,
          target_sets: 3,
          target_reps_min: 8,
          target_reps_max: 10,
          target_weight_kg: 20,
          rest_time_seconds: 60,
        }],
      },
    });
    expect(plan.status()).toBe(201);
    planId = (await plan.json()).id;
    const started = await request.post("/api/v1/workout-sessions", {
      data: { source_plan_id: planId },
    });
    expect(started.status()).toBe(201);
    sessionId = (await started.json()).id;
    const sessionPath = `/api/v1/workout-sessions/${sessionId}`;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === `${sessionPath}/sets`) {
        replayRequests += 1;
      }
    });
    await page.goto("/workout");

    const position = page.locator("#hud-position");
    const sync = page.locator("#active-sync-status");
    const complete = page.getByRole("button", { name: "Complete set & start rest" });
    await expect(position).toHaveText("EXERCISE 1 OF 1 • SET 1 OF 3");
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true);
    await complete.click();
    await expect(sync).toHaveText("Pending synchronization");
    await expect(position).toHaveText("EXERCISE 1 OF 1 • SET 2 OF 3");
    await page.reload();
    await expect(page.getByRole("heading", { name: `${tag} Row` })).toBeVisible();
    await expect(position).toHaveText("EXERCISE 1 OF 1 • SET 2 OF 3");
    await expect(sync).toHaveText("Pending synchronization");
    await expect(page.getByRole("timer")).toHaveText(/RESTING — 00:\d\d/);
    const cachedApiPaths = await page.evaluate(async () => {
      const entries = await Promise.all((await caches.keys()).map(async (key) => (await caches.open(key)).keys()));
      return entries.flat().map((entry) => new URL(entry.url).pathname).filter((path) => path.startsWith("/api/"));
    });
    expect(cachedApiPaths).toEqual([]);

    await context.setOffline(false);
    await expect(sync).toHaveText("Synchronized");
    expect(replayRequests).toBe(1);
    await page.getByRole("button", { name: "Skip Rest" }).click();
    await expect(complete).toBeVisible();

    await context.setOffline(true);
    await complete.click();
    await expect(sync).toHaveText("Pending synchronization");
    await expect(position).toHaveText("EXERCISE 1 OF 1 • SET 3 OF 3");
    await context.clearCookies();
    await context.setOffline(false);
    await expect(page).toHaveURL(/\/login$/);
    expect(replayRequests).toBe(1);
    const current = await request.get(sessionPath);
    expect(current.status()).toBe(200);
    expect((await current.json()).exercises[0].set_entries).toHaveLength(1);

    await context.setOffline(true);
    await page.goto("/workout");
    await expect(page.getByText("Reconnect to sign in.")).toBeVisible();
    await expect(page.getByRole("heading", { name: `${tag} Row` })).toHaveCount(0);
    const pending = await readWorkoutStorage(page, "workout_logger_active_set_queue");
    expect(typeof pending === "string" ? JSON.parse(pending) : null).toMatchObject([
      { session_id: sessionId, payload: { set_number: 2 } },
    ]);
  } finally {
    await context.setOffline(false);
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
      expect((await request.get(`/api/v1/workout-sessions/${sessionId}`)).status()).toBe(404);
    }
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
