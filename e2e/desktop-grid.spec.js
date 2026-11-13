import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

test("desktop workout: even rows, a real Previous column, rest bar inside the viewport", async ({
  page,
  request,
}) => {
  test.skip(!isDesktop(page), "The grid is the desktop layout of the live workout");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `dgrid-${Date.now()}`}:dgrid]`;
  const name = `${tag} Bench`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let sessionId;
  /** @type {string | undefined} */
  let priorLogId;

  try {
    page.setDefaultTimeout(5_000);
    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        description: `${tag} desktop grid fixture`,
        exercises: [
          {
            exercise_name: name,
            target_sets: 3,
            target_reps_min: 5,
            target_reps_max: 8,
            target_weight_kg: 60,
            rest_time_seconds: 90,
          },
        ],
      },
    });
    expect(planResponse.status()).toBe(201);
    planId = (await planResponse.json()).id;

    // Last time: 50 kg for 8, 7 and 6.
    const prior = await request.post("/api/v1/logs", {
      data: {
        source_plan_id: planId,
        performed_at: new Date(Date.now() - 86_400_000).toISOString(),
        total_time_minutes: 30,
        overall_feeling: 4,
        notes: `${tag} prior`,
        exercises: [
          {
            exercise_name: name,
            sets_count: 3,
            reps_per_set: [8, 7, 6],
            weight_kg: 50,
            rest_time_seconds: 90,
          },
        ],
      },
    });
    expect(prior.status()).toBe(201);
    priorLogId = (await prior.json()).id;

    await page.goto("/");
    await openPage(page, "Plans");
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} plan` })
      .getByRole("button", { name: "Start workout" })
      .click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    sessionId = (await (await request.get("/api/v1/workout-sessions/active")).json()).id;

    /** @param {number} set */
    const row = (set) =>
      page.locator(`[data-exercise-name="${name}"][data-set-number="${set}"]`);

    // "Previous" is last session's same set, not the plan target (60 kg × 5).
    await expect(row(1)).toContainText("50 kg × 8");
    await expect(row(2)).toContainText("50 kg × 7");
    await expect(row(3)).toContainText("50 kg × 6");

    // Every row is the same height: the actions never wrap onto a second line.
    const heights = [];
    for (const set of [1, 2, 3]) heights.push((await row(set).boundingBox())?.height ?? 0);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);

    // Logging starts rest; the countdown is in mm:ss and inside the viewport.
    await row(1).getByRole("button", { name: `Complete ${name} set 1` }).click();
    const rest = page.locator("#active-rest-overlay");
    await expect(rest.getByRole("timer")).toContainText(/Rest: 0(1:29|1:30)/);
    const box = await rest.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
  } finally {
    if (!sessionId && planId) {
      const active = await request.get("/api/v1/workout-sessions/active");
      if (active.status() === 200) sessionId = (await active.json()).id;
    }
    if (sessionId) await request.delete(`/api/v1/workout-sessions/${sessionId}`);
    if (priorLogId) await request.delete(`/api/v1/logs/${priorLogId}`);
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
    if (priorLogId)
      expect((await request.get(`/api/v1/logs/${priorLogId}`)).status()).toBe(404);
  }
});
