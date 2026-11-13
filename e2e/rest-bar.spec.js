import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

test("the phone's rest timer stays visible across pages and never moves the Log button", async ({
  page,
  request,
}) => {
  test.skip(isDesktop(page), "The persistent rest bar is the phone layout");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `restbar-${Date.now()}`}:restbar]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        description: `${tag} rest bar fixture`,
        exercises: [
          {
            exercise_name: `${tag} Squat`,
            target_sets: 3,
            target_reps_min: 5,
            target_reps_max: 8,
            target_weight_kg: 80,
            rest_time_seconds: 60,
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
    await expect(page.getByRole("heading", { name: `${tag} Squat` })).toBeVisible();
    sessionId = (await (await request.get("/api/v1/workout-sessions/active")).json()).id;

    const bar = page.getByTestId("rest-bar");
    const log = page.getByRole("button", { name: "Complete set & start rest" });
    await expect(bar).toBeHidden();
    const before = await log.boundingBox();
    expect(before).not.toBeNull();

    await log.click();
    await expect(page.getByRole("timer")).toHaveText(/^RESTING — 00:(59|60|58)$/);
    // The Log button keeps its place and size while resting.
    const after = await log.boundingBox();
    expect(after).toEqual(before);

    // Every control on the bar is a comfortable touch target.
    for (const name of ["−15 seconds", "+15 seconds", "Skip Rest"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // Leaving the workout keeps the timer on screen, on every page.
    await page.getByRole("button", { name: "Minimize workout" }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(bar).toBeVisible();
    await openPage(page, "History");
    await expect(page).toHaveURL(/\/history/);
    await expect(bar).toBeVisible();
    await expect(page.getByRole("timer")).toHaveText(/^RESTING — 00:\d\d$/);

    // And it survives a reload.
    await page.reload();
    await expect(bar).toBeVisible();

    await page.getByRole("button", { name: "+15 seconds" }).click();
    await expect(page.getByRole("timer")).toHaveText(/^RESTING — 01:\d\d$/);
    await page.getByRole("button", { name: "Skip Rest" }).click();
    await expect(bar).toBeHidden();
  } finally {
    if (!sessionId && planId) {
      const active = await request.get("/api/v1/workout-sessions/active");
      if (active.status() === 200) sessionId = (await active.json()).id;
    }
    if (sessionId) await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
