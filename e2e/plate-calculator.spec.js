import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

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

test("configures a location bar and selects it for the workout plate calculation", async ({
  page, request,
}) => {
  test.skip(isDesktop(page), "The barbell calculator is on the phone workout HUD");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `profile-${Date.now()}`}:profile]`;
  const locationName = `${tag} Strength room`;
  const exerciseName = `${tag} Barbell press`;
  const dumbbellName = `${tag} Dumbbell press`;
  let locationId;
  let exerciseId;
  let dumbbellExerciseId;
  let planId;
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    const location = await request.post("/api/v1/locations", {
      data: { name: locationName, kind: "gym" },
    });
    expect(location.status()).toBe(201);
    locationId = (await location.json()).id;

    await page.goto("/");
    await openPage(page, "Locations");
    const locationList = page.getByRole("list", { name: "Locations" });
    await locationList.getByRole("button", { name: "Add bar profile" }).click();
    await locationList.getByRole("button", { name: "Add bar profile" }).click();
    await page.getByLabel("Bar profile 1 name").fill("Safety squat bar");
    await page.getByLabel("Bar profile 1 bar weight (kg)").fill("25");
    await page.getByLabel("Bar profile 2 name").fill("15 kg technique bar");
    await page.getByLabel("Bar profile 2 bar weight (kg)").fill("15");
    await locationList.getByRole("button", { name: "Add dumbbell profile" }).click();
    await page.getByLabel("Dumbbell profile 1 name").fill("Adjustable pair");
    await page.getByLabel("Dumbbell profile 1 handle weight (kg)").fill("2");
    await page.getByLabel("Dumbbell profile 1 plate 1 weight (kg)").fill("4");
    await page.getByRole("button", { name: `Save ${locationName}` }).click();
    await expect(page.getByText(`Saved "${locationName}"`)).toBeVisible();

    const exercise = await request.post("/api/v1/exercises", {
      data: { name: exerciseName, equipment_any_of: [["barbell"]] },
    });
    expect(exercise.status()).toBe(201);
    exerciseId = (await exercise.json()).id;
    const dumbbellExercise = await request.post("/api/v1/exercises", {
      data: { name: dumbbellName, equipment_any_of: [["dumbbell"]] },
    });
    expect(dumbbellExercise.status()).toBe(201);
    dumbbellExerciseId = (await dumbbellExercise.json()).id;
    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        exercises: [
          {
            exercise_name: exerciseName,
            target_sets: 1,
            target_reps_min: 5,
            target_reps_max: 5,
            target_weight_kg: 75,
            rest_time_seconds: 30,
          },
          {
            exercise_name: dumbbellName,
            target_sets: 1,
            target_reps_min: 8,
            target_reps_max: 8,
            target_weight_kg: 10,
            rest_time_seconds: 30,
          },
        ],
      },
    });
    expect(plan.status()).toBe(201);
    planId = (await plan.json()).id;
    const started = await request.post("/api/v1/workout-sessions", {
      data: { source_plan_id: planId, location_id: locationId },
    });
    expect(started.status()).toBe(201);
    sessionId = (await started.json()).id;

    await page.goto("/workout");
    await expect(page.getByRole("heading", { name: exerciseName })).toBeVisible();
    await page.getByText("Barbell plates", { exact: true }).click();
    await expect(page.getByLabel("Bar profile")).toHaveValue("Safety squat bar");
    await expect(page.getByText("Safety squat bar · Bar 25 kg · Collars 0 kg")).toBeVisible();
    await expect(page.getByText("Per side: 1 × 25 kg", { exact: true })).toBeVisible();
    await page.getByLabel("Bar profile").selectOption("15 kg technique bar");
    await expect(page.getByText("15 kg technique bar · Bar 15 kg · Collars 0 kg")).toBeVisible();
    await expect(page.getByText("Per side: 1 × 20 kg + 1 × 10 kg", { exact: true })).toBeVisible();
    await page.getByLabel("Bar profile").selectOption("default");
    await expect(page.getByText("Default inventory · Bar 20 kg · Collars 0 kg")).toBeVisible();
    const active = await request.get(`/api/v1/workout-sessions/${sessionId}`);
    expect((await active.json()).location.plate_profiles[0]).toMatchObject({
      name: "Safety squat bar", bar_kg: 25, collars_kg: 0,
    });
    expect((await active.json()).location.dumbbell_profiles[0]).toMatchObject({
      name: "Adjustable pair", handle_kg: 2, collars_kg: 0,
    });

    await page.getByRole("button", { name: "Complete set & start rest" }).click();
    await expect(page.getByRole("heading", { name: dumbbellName })).toBeVisible();
    await expect(page.getByText("Barbell plates", { exact: true })).toHaveCount(0);
    await page.getByText("Dumbbell plates", { exact: true }).click();
    await expect(page.getByLabel("Dumbbell profile")).toHaveValue("Adjustable pair");
    await expect(page.getByText("Adjustable pair · Handle 2 kg · Collars 0 kg")).toBeVisible();
    await expect(page.getByText("Per dumbbell: 1 × 4 kg on each side", { exact: true })).toBeVisible();
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
    if (dumbbellExerciseId) {
      await request.delete(`/api/v1/exercises/${dumbbellExerciseId}`);
      expect((await request.get(`/api/v1/exercises/${dumbbellExerciseId}`)).status()).toBe(404);
    }
    if (locationId) {
      await request.delete(`/api/v1/locations/${locationId}`);
      expect((await request.get(`/api/v1/locations/${locationId}`)).status()).toBe(404);
    }
  }
});
