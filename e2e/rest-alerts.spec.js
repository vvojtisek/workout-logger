import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

/** @typedef {Window & {__restVibrations: VibratePattern[], __restToneCount: number}} TestWindow */

test("rest alert preferences persist on this device", async ({ page }) => {
  await page.goto("/");
  await openPage(page, "Settings");
  const sound = page.getByRole("button", { name: "Rest sound" });
  const vibration = page.getByRole("button", { name: "Rest vibration" });
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await expect(vibration).toHaveAttribute("aria-pressed", "true");
  await sound.click();
  await vibration.click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Rest sound" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Rest vibration" })).toHaveAttribute("aria-pressed", "false");
});

test("notifies once when a real workout rest expires", async ({ page, request }) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || `alerts-${Date.now()}`}:rest-alert]`;
  const exerciseName = `${tag} Press`;
  let exerciseId;
  let planId;
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript(() => {
      const testWindow = /** @type {TestWindow} */ (
        /** @type {unknown} */ (window)
      );
      testWindow.__restVibrations = [];
      testWindow.__restToneCount = 0;
      if (window.AudioContext) {
        const createOscillator = window.AudioContext.prototype.createOscillator;
        window.AudioContext.prototype.createOscillator = function () {
          testWindow.__restToneCount += 1;
          return createOscillator.call(this);
        };
      }
      Object.defineProperty(navigator, "vibrate", {
        configurable: true,
        value: (/** @type {VibratePattern} */ pattern) => {
          testWindow.__restVibrations.push(pattern);
          return true;
        },
      });
    });
    const exercise = await request.post("/api/v1/exercises", {
      data: { name: exerciseName, equipment_any_of: [["barbell"]] },
    });
    expect(exercise.status()).toBe(201);
    exerciseId = (await exercise.json()).id;
    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        exercises: [{
          exercise_name: exerciseName,
          target_sets: 1,
          target_reps_min: 5,
          target_reps_max: 5,
          target_weight_kg: 40,
          rest_time_seconds: 2,
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
    await expect(page.getByRole("heading", { name: exerciseName })).toBeVisible();
    const completeButton = isDesktop(page)
      ? page.getByRole("button", { name: "Save set" })
      : page.getByRole("button", { name: "Complete set & start rest" });
    await completeButton.click();
    await expect.poll(() => page.evaluate(() => {
      const testWindow = /** @type {TestWindow} */ (
        /** @type {unknown} */ (window)
      );
      return testWindow.__restVibrations.length;
    }), { timeout: 5_000 }).toBe(1);
    await page.waitForTimeout(1_500);
    expect(await page.evaluate(() => {
      const testWindow = /** @type {TestWindow} */ (
        /** @type {unknown} */ (window)
      );
      return testWindow.__restVibrations;
    })).toEqual([[80, 60, 80]]);
    expect(await page.evaluate(() => {
      const testWindow = /** @type {TestWindow} */ (
        /** @type {unknown} */ (window)
      );
      return testWindow.__restToneCount;
    })).toBe(1);
  } finally {
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
      expect((await request.get(`/api/v1/workout-sessions/${sessionId}`)).status()).toBe(404);
    }
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
    if (exerciseId) {
      await request.delete(`/api/v1/exercises/${exerciseId}`);
      expect((await request.get(`/api/v1/exercises/${exerciseId}`)).status()).toBe(404);
    }
  }
});
