import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";

/**
 * @param {{x: number, y: number, width: number, height: number} | null} a
 * @param {{x: number, y: number, width: number, height: number} | null} b
 */
function overlaps(a, b) {
  if (!a || !b) throw new Error("Element is not rendered");
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("desktop workout: exercise list, progression chart, copy, add set and swap", async ({
  page,
  request,
}) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || `desk-${Date.now()}`}:desk]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let sessionId;
  /** @type {string[]} */
  const logIds = [];

  try {
    page.setDefaultTimeout(5_000);
    const planResponse = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        description: `${tag} desktop workout fixture`,
        exercises: [
          {
            exercise_name: `${tag} Bench`,
            target_sets: 2,
            target_reps_min: 6,
            target_reps_max: 8,
            target_weight_kg: 40,
            rest_time_seconds: 30,
          },
          {
            exercise_name: `${tag} Curl`,
            target_sets: 1,
            target_reps_min: 10,
            target_reps_max: 12,
            target_weight_kg: 12,
            rest_time_seconds: 30,
          },
        ],
      },
    });
    expect(planResponse.status()).toBe(201);
    planId = (await planResponse.json()).id;

    // Two earlier sessions give the progression chart two points.
    for (const [daysAgo, weight] of [
      [2, 40],
      [1, 45],
    ]) {
      const log = await request.post("/api/v1/logs", {
        data: {
          source_plan_id: planId,
          performed_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
          total_time_minutes: 30,
          overall_feeling: 3,
          notes: `${tag} history`,
          exercises: [
            {
              exercise_name: `${tag} Bench`,
              sets_count: 2,
              reps_per_set: [8, 8],
              weight_kg: weight,
              rest_time_seconds: 30,
            },
          ],
        },
      });
      expect(log.status()).toBe(201);
      logIds.push((await log.json()).id);
    }

    await page.goto("/");
    await openPage(page, "Plans");
    await page
      .getByRole("listitem")
      .filter({ hasText: `${tag} plan` })
      .getByRole("button", { name: "Start workout" })
      .click();
    await expect(page.getByRole("heading", { name: `${tag} Bench` })).toBeVisible();
    sessionId = (await (await request.get("/api/v1/workout-sessions/active")).json()).id;

    // Exercise list pane beside the shown exercise.
    const list = page.getByRole("navigation", { name: "Workout exercises" });
    expect((await list.boundingBox())?.width).toBe(340);
    const benchItem = list.getByRole("button", { name: new RegExp(`${tag.replace(/[[\]]/g, "\\$&")} Bench`) });
    const curlItem = list.getByRole("button", { name: new RegExp(`${tag.replace(/[[\]]/g, "\\$&")} Curl`) });
    await expect(benchItem).toHaveAttribute("aria-current", "true");
    await expect(benchItem).toContainText("2 × 6–8 @ 40 kg");
    await expect(benchItem).toContainText("0 of 2 sets logged");

    // Progression from the real history.
    const chart = page.getByTestId("progression-chart");
    await expect(chart).toHaveAttribute("aria-label", /last 2 sessions/);
    await expect(page.getByTestId("progression-card")).toContainText("45 kg × 8");

    /** @param {number} setNumber */
    const row = (setNumber) =>
      page.locator(`[data-exercise-name="${tag} Bench"][data-set-number="${setNumber}"]`);
    await row(1).getByLabel("Weight (kg)").fill("50");
    await row(1).getByLabel("Repetitions").fill("6");
    await row(1).getByLabel("RIR").fill("2");
    await row(1).getByRole("button", { name: `Complete ${tag} Bench set 1` }).click();
    await expect(row(1)).toHaveAttribute("data-state", "completed");
    await expect(benchItem).toContainText("1 of 2 sets logged");

    // The rest card is docked beside or below the table, never over a set.
    const rest = page.locator("#active-rest-overlay");
    await expect(rest.getByRole("timer")).toContainText(/Rest: \d+s/);
    expect(overlaps(await rest.boundingBox(), await row(2).boundingBox())).toBe(false);

    // Copy Last Set fills the next set with what was just logged, RIR blank.
    await page.getByRole("button", { name: "Copy Last Set" }).click();
    await expect(row(2).getByLabel("Weight (kg)")).toHaveValue("50");
    await expect(row(2).getByLabel("Repetitions")).toHaveValue("6");
    await expect(row(2).getByLabel("RIR")).toHaveValue("");

    // + Add Set grows this workout only.
    await page.getByRole("button", { name: "+ Add Set" }).click();
    await expect(row(3)).toBeVisible();
    await expect(page.locator("#active-progress-text")).toHaveText("1 of 4 sets");
    let body = await (await request.get(`/api/v1/workout-sessions/${sessionId}`)).json();
    expect(body.exercises[0].target_sets).toBe(3);
    const plan = await (await request.get(`/api/v1/plans/${planId}`)).json();
    expect(plan.exercises[0].target_sets).toBe(2);

    // An exercise with logged sets can't be swapped; an untouched one can.
    await expect(page.getByRole("button", { name: "Swap Exercise" })).toBeDisabled();
    await curlItem.click();
    await expect(page.getByRole("heading", { name: `${tag} Curl` })).toBeVisible();
    await expect(curlItem).toHaveAttribute("aria-current", "true");
    await page.getByRole("button", { name: "Swap Exercise" }).click();
    const dialog = page.getByRole("dialog", { name: `Swap ${tag} Curl` });
    await dialog.getByLabel("Exercise instead").fill(`${tag} Hammer Curl`);
    await dialog.getByRole("button", { name: "Swap" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: `${tag} Hammer Curl` })).toBeVisible();
    body = await (await request.get(`/api/v1/workout-sessions/${sessionId}`)).json();
    expect(body.exercises[1].exercise_name).toBe(`${tag} Hammer Curl`);
    expect(
      (await (await request.get(`/api/v1/plans/${planId}`)).json()).exercises[1].exercise_name,
    ).toBe(`${tag} Curl`);

    // The selection is the server's focus, so it survives a reload.
    await page.reload();
    await expect(page.getByRole("heading", { name: `${tag} Hammer Curl` })).toBeVisible();
  } finally {
    if (!sessionId && planId) {
      const active = await request.get("/api/v1/workout-sessions/active");
      if (active.status() === 200) sessionId = (await active.json()).id;
    }
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
      expect((await request.get(`/api/v1/workout-sessions/${sessionId}`)).status()).toBe(404);
    }
    for (const logId of logIds) {
      await request.delete(`/api/v1/logs/${logId}`);
      expect((await request.get(`/api/v1/logs/${logId}`)).status()).toBe(404);
    }
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
