import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

test("logging a set updates the screen at once, even offline, and syncs on reconnect", async ({
  page,
  request,
}) => {
  test.skip(isDesktop(page), "Measured on the phone HUD");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `optimistic-${Date.now()}`}:optimistic]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        description: `${tag} optimistic fixture`,
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

    // Network gone. The tap must still change the screen immediately.
    await page.context().setOffline(true);
    const elapsed = await page
      .getByRole("button", { name: "Complete set & start rest" })
      .evaluate(async (button) => {
        const started = performance.now();
        /** @type {HTMLElement} */ (button).click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
        );
        const shown =
          document.querySelector('[data-testid="rest-bar"]') !== null &&
          document.querySelector('#hud-position')?.textContent?.includes("SET 2");
        return shown ? performance.now() - started : -1;
      });
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);

    await expect(page.getByRole("timer")).toHaveText(/^RESTING — (01:00|00:5\d)$/);
    const trail = page.getByRole("list", { name: "Sets of this exercise" });
    await expect(trail.getByRole("listitem").nth(0)).toHaveAttribute("data-state", "done");
    await expect(page.locator("#active-sync-status")).toHaveText("Pending synchronization");

    // The server has not heard about it yet.
    let body = await (await request.get(`/api/v1/workout-sessions/${sessionId}`)).json();
    expect(body.exercises[0].set_entries).toHaveLength(0);

    // Back online: the queue drains and the real entry replaces the local one.
    await page.context().setOffline(false);
    await expect(page.locator("#active-sync-status")).toHaveText("Synchronized");
    body = await (await request.get(`/api/v1/workout-sessions/${sessionId}`)).json();
    expect(body.exercises[0].set_entries[0]).toMatchObject({
      set_number: 1,
      reps: 5,
      state: "completed",
    });
    await expect(trail.getByRole("listitem").nth(0)).toHaveAttribute("data-state", "done");
  } finally {
    await page.context().setOffline(false);
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
