import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";
import { readWorkoutStorage } from "./support/workout.js";

test("rest timer and an offline set retry recover against the real server", async ({
  context,
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `timer-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:timer]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
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
            target_sets: 4,
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
    await openPage(page, "Plans");
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
    await expect(restOverlay.getByRole("timer")).toContainText(/Rest: 0(0:59|1:00)/);
    await expect(row(1).getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(row(1).getByRole("button", { name: "Undo" })).toBeVisible();
    const overlayBox = await restOverlay.boundingBox();
    const currentBox = await row(2).boundingBox();
    expect(overlayBox).not.toBeNull();
    expect(currentBox).not.toBeNull();
    if (!overlayBox || !currentBox) throw new Error("Timer or current set is not rendered");
    // The rest card is docked beside or below the set table, never over a set.
    const apart =
      currentBox.x + currentBox.width <= overlayBox.x ||
      overlayBox.x + overlayBox.width <= currentBox.x ||
      currentBox.y + currentBox.height <= overlayBox.y ||
      overlayBox.y + overlayBox.height <= currentBox.y;
    expect(apart).toBe(true);

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

    await restOverlay.getByRole("button", { name: "+15 seconds" }).click();
    await expect
      .poll(async () => {
        const body = await (
          await request.get(`/api/v1/workout-sessions/${sessionId}`)
        ).json();
        return new Date(body.rest_ends_at).getTime() - originalEnd;
      })
      .toBe(15_000);
    await restOverlay.getByRole("button", { name: "−15 seconds" }).click();
    await expect
      .poll(async () => {
        const body = await (
          await request.get(`/api/v1/workout-sessions/${sessionId}`)
        ).json();
        return new Date(body.rest_ends_at).getTime();
      })
      .toBe(originalEnd);

    await row(2).getByLabel("Weight (kg)").fill("62.75");
    await row(2).getByLabel("Repetitions").fill("8");
    await row(2).getByLabel("RIR").fill("1");
    await row(3).getByRole("button", { name: `Open ${tag} Deadlift set 3` }).click();
    await row(2).getByRole("button", { name: `Open ${tag} Deadlift set 2` }).click();
    await expect(row(2).getByLabel("Weight (kg)")).toHaveValue("62.75");
    await expect(row(2).getByLabel("Repetitions")).toHaveValue("8");
    await expect(row(2).getByLabel("RIR")).toHaveValue("1");
    await page.reload();
    await expect(restOverlay.getByRole("timer")).toContainText(/Rest: 0(0:59|1:00)/);
    await expect(row(2).getByLabel("Weight (kg)")).toHaveValue("62.75");
    await expect(row(2).getByLabel("Repetitions")).toHaveValue("8");
    await expect(row(2).getByLabel("RIR")).toHaveValue("1");

    await page.clock.fastForward(61_000);
    await expect(restOverlay.getByRole("status")).toHaveText("Rest complete");

    await row(3).getByLabel("Repetitions").fill("7");
    await context.setOffline(true);
    // Dispatch both real actions in one task so the second queue read cannot
    // depend on the first async browser write already having finished.
    await page.evaluate(() => {
      const complete = document.querySelector('[data-set-number="2"] button[type="submit"]');
      const skip = document.querySelector('[data-set-number="3"] button[aria-label^="Skip "]');
      if (!(complete instanceof HTMLButtonElement) || !(skip instanceof HTMLButtonElement)) {
        throw new Error("Both offline set actions must be present");
      }
      complete.click();
      skip.click();
    });
    await expect(page.locator("#active-sync-status")).toHaveText("Pending synchronization");
    const queueKey = "workout_logger_active_set_queue";
    const readQueue = async () => {
      const value = await readWorkoutStorage(page, queueKey);
      return typeof value === "string" ? JSON.parse(value) : [];
    };
    await expect.poll(async () => (await readQueue()).length).toBe(2);
    const queued = await readQueue();
    expect(queued[0].payload.set_number).toBe(2);
    expect(queued[1].payload.set_number).toBe(3);

    await context.setOffline(false);
    await expect(page.locator("#active-sync-status")).toHaveText("Synchronized");
    await expect(row(2)).toHaveAttribute("data-state", "completed");
    await expect(row(3)).toHaveAttribute("data-state", "skipped");
    const synchronized = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    /** @type {Array<{set_number: number, state: string, weight_kg: number | null, reps: number, rir: number | null, client_operation_id: string}>} */
    const synchronizedEntries = synchronized.exercises[0].set_entries;
    expect(synchronizedEntries.filter((entry) => entry.set_number >= 2)).toEqual([
      expect.objectContaining({
        set_number: 2,
        state: "completed",
        weight_kg: 62.75,
        reps: 8,
        rir: 1,
        client_operation_id: queued[0].client_operation_id,
      }),
      expect.objectContaining({
        set_number: 3,
        state: "skipped",
        reps: 7,
        client_operation_id: queued[1].client_operation_id,
      }),
    ]);
    expect(await readQueue()).toEqual([]);
    expect(synchronized.rest_ends_at).not.toBeNull();

    await restOverlay.getByRole("button", { name: "Skip rest" }).click();
    await expect(restOverlay.getByRole("timer")).toHaveText("Rest skipped");
    const skippedRest = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    expect(skippedRest.rest_ends_at).toBeNull();

    await row(4).getByRole("button", { name: `Skip ${tag} Deadlift set 4` }).click();
    await expect(row(4)).toHaveAttribute("data-state", "skipped");
    // The screen updates before the write reaches the server, so wait for it.
    await expect
      .poll(async () => {
        const body = await (
          await request.get(`/api/v1/workout-sessions/${sessionId}`)
        ).json();
        return body.exercises[0].set_entries.length;
      })
      .toBe(4);
    const skippedSet = await (
      await request.get(`/api/v1/workout-sessions/${sessionId}`)
    ).json();
    expect(skippedSet.rest_ends_at).toBeNull();
    expect(skippedSet.exercises[0].set_entries).toHaveLength(4);
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
