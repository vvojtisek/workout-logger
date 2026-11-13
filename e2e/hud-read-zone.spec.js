import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

test("the phone HUD shows the set trail and what is next", async ({ page, request }) => {
  test.skip(isDesktop(page), "The HUD is the phone layout of the live workout");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `readzone-${Date.now()}`}:readzone]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        description: `${tag} read zone fixture`,
        exercises: [
          {
            exercise_name: `${tag} Squat`,
            target_sets: 3,
            target_reps_min: 5,
            target_reps_max: 8,
            target_weight_kg: 80,
            rest_time_seconds: 30,
          },
          {
            exercise_name: `${tag} Row`,
            target_sets: 2,
            target_reps_min: 8,
            target_reps_max: 12,
            target_weight_kg: 40,
            rest_time_seconds: 30,
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

    const trail = page.getByRole("list", { name: "Sets of this exercise" });
    await expect(trail.getByRole("listitem")).toHaveCount(3);
    await expect(trail.getByRole("listitem").nth(0)).toHaveAttribute("data-state", "current");
    await expect(page.locator("#hud-up-next")).toContainText(`${tag} Row · 2 sets · 40 kg × 8`);

    await page.getByRole("button", { name: "Complete set & start rest" }).click();
    await expect(trail.getByRole("listitem").nth(0)).toHaveAttribute("data-state", "done");
    await expect(trail.getByRole("listitem").nth(0)).toContainText("80×");
    await expect(trail.getByRole("listitem").nth(1)).toHaveAttribute("data-state", "current");
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
