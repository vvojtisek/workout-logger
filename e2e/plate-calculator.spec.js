import { expect, test } from "@playwright/test";

import { isDesktop } from "./support/navigation.js";

test("shows live barbell plate counts on the phone without changing the recorded load", async ({
  page, request,
}) => {
  test.skip(isDesktop(page), "The inline plate calculator is on the phone workout HUD");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `plate-${Date.now()}`}:plates]`;
  const barbellName = `${tag} Press`;
  const machineName = `${tag} Machine row`;
  /** @type {string[]} */
  const exerciseIds = [];
  let planId;
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    for (const [name, equipment] of [[barbellName, "barbell"], [machineName, "machine"]]) {
      const added = await request.post("/api/v1/exercises", {
        data: { name, equipment_any_of: [[equipment]] },
      });
      expect(added.status()).toBe(201);
      exerciseIds.push((await added.json()).id);
    }
    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        exercises: [barbellName, machineName].map((name) => ({
          exercise_name: name,
          target_sets: 1,
          target_reps_min: 8,
          target_reps_max: 10,
          target_weight_kg: 60,
          rest_time_seconds: 30,
        })),
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
    await expect(page.getByRole("heading", { name: barbellName })).toBeVisible();

    await page.getByText("Barbell plates", { exact: true }).click();
    await expect(page.getByText("Bar 20 kg · Collars 0 kg")).toBeVisible();
    await expect(page.getByText("Per side: 1 × 20 kg", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "+2.5" }).click();
    await expect(page.getByText("Per side: 1 × 20 kg + 1 × 1.25 kg")).toBeVisible();
    await page.getByLabel("Weight (kg)").fill("63");
    await expect(page.getByText("63 kg is unavailable with these plates.")).toBeVisible();
    await expect(page.getByText("Nearest below: 62.5 kg", { exact: false })).toBeVisible();
    await expect(page.getByText("Nearest above: 65 kg", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Complete set & start rest" }).click();
    await expect(page.getByRole("heading", { name: machineName })).toBeVisible();
    await expect(page.getByText("Barbell plates", { exact: true })).toHaveCount(0);
    const saved = await request.get(`/api/v1/workout-sessions/${sessionId}`);
    expect(saved.status()).toBe(200);
    expect((await saved.json()).exercises[0]).toMatchObject({
      equipment_any_of: [["barbell"]],
      set_entries: [{ weight_kg: 63, reps: 8 }],
    });
  } finally {
    if (sessionId) {
      await request.delete(`/api/v1/workout-sessions/${sessionId}`);
      expect((await request.get(`/api/v1/workout-sessions/${sessionId}`)).status()).toBe(404);
    }
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
    for (const id of exerciseIds) {
      await request.delete(`/api/v1/exercises/${id}`);
      expect((await request.get(`/api/v1/exercises/${id}`)).status()).toBe(404);
    }
  }
});
