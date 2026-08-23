import { expect, test } from "@playwright/test";

test("ingests weight, sleep, a session, and steps through the real API and verifies them in the GUI", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `ingest-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:ingest]`;
  const source = `e2e-${TEST_RUN_ID}`;

  let weightId;
  let sleepId;
  let sessionId;

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");

    // Weight: ingest via the real API, exactly as a sync app would, then
    // prove a replay of the same source+external_id is idempotent.
    const weightPayload = {
      measured_at: "2032-05-01T07:00:00Z",
      weight_kg: 61.3,
      body_fat_percent: 19.4,
      source,
      external_id: "weight-1",
    };
    const weightFirst = await request.post("/api/v1/ingest/weight", { data: weightPayload });
    expect(weightFirst.status()).toBe(201);
    const weightFirstBody = await weightFirst.json();
    expect(weightFirstBody.created).toBe(true);
    weightId = weightFirstBody.id;

    const weightReplay = await request.post("/api/v1/ingest/weight", { data: weightPayload });
    expect(weightReplay.status()).toBe(200);
    const weightReplayBody = await weightReplay.json();
    expect(weightReplayBody.created).toBe(false);
    expect(weightReplayBody.id).toBe(weightId);

    // The ingested weight shows up in the real Biometrics GUI, same as a
    // manually logged entry would.
    await page.goto("/");
    await page.getByRole("button", { name: "Biometrics" }).click();
    await expect(page.getByRole("heading", { name: "Biometrics" })).toBeVisible();
    await expect(page.getByText("61.3 kg", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("19.4% BF")).toBeVisible();

    // Sleep: ingest via the API, then confirm it renders in the Sleep GUI.
    const sleepFirst = await request.post("/api/v1/ingest/sleep", {
      data: {
        sleep_start: "2032-05-02T04:00:00Z",
        sleep_end: "2032-05-02T12:00:00Z",
        timezone: "America/New_York",
        notes: `${tag} synced sleep`,
        source,
        external_id: "sleep-1",
      },
    });
    expect(sleepFirst.status()).toBe(201);
    const sleepFirstBody = await sleepFirst.json();
    expect(sleepFirstBody.time_in_bed_seconds).toBe(28_800);
    sleepId = sleepFirstBody.id;

    await page.getByRole("button", { name: "Sleep" }).click();
    await expect(page.getByRole("heading", { name: "Sleep" })).toBeVisible();
    await expect(page.getByText(`${tag} synced sleep`)).toBeVisible();
    await expect(page.getByText("8h 0m").first()).toBeVisible();

    // Sessions: ingest a completed workout, then open it directly by id
    // through the real History detail route.
    const sessionFirst = await request.post("/api/v1/ingest/sessions", {
      data: {
        performed_at: "2032-05-03T09:00:00Z",
        total_time_minutes: 47,
        overall_feeling: 4,
        notes: `${tag} synced session`,
        source,
        external_id: "session-1",
        exercises: [{ exercise_name: "Outdoor Run", sets_count: 1, reps_per_set: [1] }],
      },
    });
    expect(sessionFirst.status()).toBe(201);
    const sessionFirstBody = await sessionFirst.json();
    sessionId = sessionFirstBody.id;

    await page.goto(`/history/${sessionId}`);
    await expect(page.getByRole("heading", { name: "Workout Detail" })).toBeVisible();
    await expect(page.getByText(`${tag} synced session`)).toBeVisible();
    await expect(page.getByText("Outdoor Run", { exact: false })).toBeVisible();

    // Steps has no GUI (nothing in the plan calls for one) — verify the
    // idempotent ingest contract holds against the real server all the same.
    const stepsPayload = {
      recorded_date: "2032-05-01",
      steps: 9321,
      source,
      external_id: "steps-1",
    };
    const stepsFirst = await request.post("/api/v1/ingest/steps", { data: stepsPayload });
    expect(stepsFirst.status()).toBe(201);
    expect((await stepsFirst.json()).created).toBe(true);
    const stepsReplay = await request.post("/api/v1/ingest/steps", { data: stepsPayload });
    expect(stepsReplay.status()).toBe(200);
    expect((await stepsReplay.json()).created).toBe(false);
  } finally {
    if (weightId) await request.delete(`/api/v1/body-metrics/${weightId}`);
    if (sleepId) await request.delete(`/api/v1/sleep-entries/${sleepId}`);
    if (sessionId) await request.delete(`/api/v1/logs/${sessionId}`);
  }
});
