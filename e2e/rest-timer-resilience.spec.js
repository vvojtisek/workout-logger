import { expect, test } from "@playwright/test";

test("rest timer and an offline set retry recover against the real server", async ({
  context,
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `timer-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:timer]`;
  let planId;
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    await page.clock.install({ time: Date.now() });
    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        description: `${tag} rest resilience fixture`,
        exercises: [
          {
            exercise_name: `${tag} Deadlift`,
            target_sets: 3,
            target_reps_min: 5,
            target_reps_max: 8,
            target_weight_kg: 60,
            rest_time_seconds: 60,
            notes: tag,
          },
        ],
      },
    });
    expect(planResponse.status()).toBe(201);
    planId = (await planResponse.json()).id;

    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");
    await page.goto("/");
    await page.getByRole("button", { name: "Plans" }).click();
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} plan` })
      .getByRole("button", { name: "Start workout" })
      .click();
    await expect(page.getByRole("heading", { name: `${tag} Deadlift` })).toBeVisible();

    const activeResponse = await request.get("/api/v1/workout-sessions/active");
    expect(activeResponse.status()).toBe(200);
    sessionId = (await activeResponse.json()).id;
    /** @param {number} setNumber */
    const row = (setNumber) => page.locator(`[data-set-number="${setNumber}"]`);

    await row(1).getByLabel("Weight (kg)").fill("61.25");
    await row(1).getByLabel("Repetitions").fill("9");
    await row(1).getByLabel("RIR").fill("2");
    await row(1).getByRole("button", { name: `Complete ${tag} Deadlift set 1` }).click();

    const restOverlay = page.locator("#active-rest-overlay");
    await expect(restOverlay).toBeVisible();
    await expect(restOverlay.getByRole("timer")).toContainText(/Rest: (59|60)s/);
    await expect(row(1).getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(row(1).getByRole("button", { name: "Undo" })).toBeVisible();
    const overlayBox = await restOverlay.boundingBox();
    const currentBox = await row(2).boundingBox();
    expect(overlayBox).not.toBeNull();
    expect(currentBox).not.toBeNull();
    if (!overlayBox || !currentBox) throw new Error("Timer or current set is not rendered");
    expect(currentBox.y + currentBox.height).toBeLessThanOrEqual(overlayBox.y);

    const savedResponse = await request.get(`/api/v1/workout-sessions/${sessionId}`);
    const saved = await savedResponse.json();
    const originalEnd = new Date(saved.rest_ends_at).getTime();
    expect(saved.exercises[0].set_entries[0]).toMatchObject({
      set_number: 1,
      weight_kg: 61.25,
      reps: 9,
      rir: 2,
      state: "completed",
    });

    await restOverlay.getByRole("button", { name: "+30 seconds" }).click();
    const extended = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    expect(new Date(extended.rest_ends_at).getTime() - originalEnd).toBe(30_000);
    await restOverlay.getByRole("button", { name: "−30 seconds" }).click();
    const restored = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    expect(new Date(restored.rest_ends_at).getTime()).toBe(originalEnd);

    await row(2).getByLabel("Weight (kg)").fill("62.75");
    await row(2).getByLabel("Repetitions").fill("8");
    await row(2).getByLabel("RIR").fill("1");
    await row(3).getByRole("button", { name: `Open ${tag} Deadlift set 3` }).click();
    await row(2).getByRole("button", { name: `Open ${tag} Deadlift set 2` }).click();
    await expect(row(2).getByLabel("Weight (kg)")).toHaveValue("62.75");
    await expect(row(2).getByLabel("Repetitions")).toHaveValue("8");
    await expect(row(2).getByLabel("RIR")).toHaveValue("1");
    await page.reload();
    await expect(restOverlay.getByRole("timer")).toContainText(/Rest: (59|60)s/);
    await expect(row(2).getByLabel("Weight (kg)")).toHaveValue("62.75");
    await expect(row(2).getByLabel("Repetitions")).toHaveValue("8");
    await expect(row(2).getByLabel("RIR")).toHaveValue("1");

    await page.clock.fastForward(61_000);
    await expect(restOverlay.getByRole("status")).toHaveText("Rest complete");

    await context.setOffline(true);
    await row(2).getByRole("button", { name: `Complete ${tag} Deadlift set 2` }).click();
    await expect(page.locator("#active-sync-status")).toHaveText("Pending synchronization");
    const queued = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("workout_logger_active_set_queue") || "[]")
    );
    expect(queued).toHaveLength(1);
    const operationId = queued[0].client_operation_id;

    await context.setOffline(false);
    await expect(page.locator("#active-sync-status")).toHaveText("Synchronized");
    await expect(row(2)).toHaveAttribute("data-state", "completed");
    const synchronized = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    /** @type {Array<{set_number: number, weight_kg: number | null, reps: number, rir: number | null, client_operation_id: string}>} */
    const synchronizedEntries = synchronized.exercises[0].set_entries;
    const setTwoEntries = synchronizedEntries.filter(
      (entry) => entry.set_number === 2
    );
    expect(setTwoEntries).toHaveLength(1);
    expect(setTwoEntries[0]).toMatchObject({
      weight_kg: 62.75,
      reps: 8,
      rir: 1,
      client_operation_id: operationId,
    });
    expect(synchronized.rest_ends_at).not.toBeNull();

    await restOverlay.getByRole("button", { name: "Skip rest" }).click();
    await expect(restOverlay.getByRole("timer")).toHaveText("Rest skipped");
    const skippedRest = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    expect(skippedRest.rest_ends_at).toBeNull();

    await row(3).getByRole("button", { name: `Skip ${tag} Deadlift set 3` }).click();
    const skippedSet = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    expect(skippedSet.rest_ends_at).toBeNull();
    expect(skippedSet.exercises[0].set_entries).toHaveLength(3);
  } finally {
    await context.setOffline(false);
    if (!sessionId && planId) {
      const active = await request.get("/api/v1/workout-sessions/active");
      if (active.status() === 200) {
        const body = await active.json();
        if (body.source_plan_id === planId) sessionId = body.id;
      }
    }
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
      expect((await request.get(`/api/v1/workout-sessions/${sessionId}`)).status()).toBe(404);
    }
    if (planId) {
      const history = await request.get(`/api/v1/logs?source_plan_id=${planId}`);
      expect(history.status()).toBe(200);
      expect((await history.json()).total).toBe(0);
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
