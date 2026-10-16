import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";

test("logs an ice hockey session and a swim through the GUI and shows them in history", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `activity-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:activity]`;
  /** @type {string[]} */
  const logIds = [];

  /** @param {string} note */
  async function findLogId(note) {
    const list = await request.get("/api/v1/logs?limit=100");
    expect(list.status()).toBe(200);
    /** @type {{items: Array<{id: string, notes: string | null}>}} */
    const body = await list.json();
    return body.items.find((log) => log.notes === note)?.id;
  }

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");
    await page.goto("/");

    // Hockey: no distance field, effort on the CR-10 scale.
    await openPage(page, "Log Activity");
    await expect(page.getByRole("heading", { name: "Log Activity", exact: true })).toBeVisible();
    await expect(page.getByLabel("Activity")).toHaveValue("ice_hockey");
    await expect(page.getByLabel("Distance (km, optional)")).toBeHidden();
    const startedAt = page.getByLabel("Started at");
    await expect(startedAt).toHaveAttribute("type", "text");
    await expect(startedAt).toHaveAttribute("placeholder", "YYYY-MM-DD HH:mm");
    await startedAt.fill("2032-05-04 19:30");
    await page.getByLabel("Duration (minutes)").fill("75");
    await page.getByLabel("Effort (optional)").selectOption("7");
    await page.getByLabel("How you felt", { exact: true }).selectOption("4");
    await page.getByLabel("Notes (optional)").fill(`${tag} hockey`);
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.getByRole("heading", { name: "Workout History", exact: true })).toBeVisible();

    const hockeyId = await findLogId(`${tag} hockey`);
    expect(hockeyId).toBeTruthy();
    if (hockeyId) logIds.push(hockeyId);
    const hockey = await (await request.get(`/api/v1/logs/${hockeyId}`)).json();
    expect(hockey).toMatchObject({
      activity_type: "ice_hockey",
      total_time_minutes: 75,
      effort_rpe: 7,
      distance_km: null,
      overall_feeling: 4,
      exercises: [],
    });

    // Swim: distance appears once the activity is not hockey.
    await openPage(page, "Log Activity");
    await page.getByLabel("Activity").selectOption("swimming");
    await page.getByLabel("Started at").fill("2032-05-05 07:00");
    await page.getByLabel("Duration (minutes)").fill("40");
    await page.getByLabel("Distance (km, optional)").fill("1.5");
    await page.getByLabel("Notes (optional)").fill(`${tag} swim`);
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.getByRole("heading", { name: "Workout History", exact: true })).toBeVisible();

    const swimId = await findLogId(`${tag} swim`);
    expect(swimId).toBeTruthy();
    if (swimId) logIds.push(swimId);
    const swim = await (await request.get(`/api/v1/logs/${swimId}`)).json();
    expect(swim).toMatchObject({ activity_type: "swimming", distance_km: 1.5, effort_rpe: null });

    // History names the activity and shows its load (RPE x minutes).
    const history = page.locator("#history-list");
    await expect(history.getByText(/75 min · Effort 7\/10 \(Very hard\) · Load 525/)).toBeVisible();
    await expect(history.getByText(/40 min · 1\.5 km/)).toBeVisible();
    // Dates use ISO order with a 24-hour clock, whatever the browser locale.
    await expect(history.getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · 75 min/)).toBeVisible();
    await expect(history.getByText(/\b(AM|PM)\b/)).toHaveCount(0);

    await history.getByText(/75 min · Effort 7\/10 \(Very hard\) · Load 525/).click();
    await expect(page.getByRole("heading", { name: "Workout Detail" })).toBeVisible();
    await expect(page.locator("#detail-content").getByText("Ice hockey", { exact: true })).toBeVisible();
    await expect(page.getByText(`${tag} hockey`)).toBeVisible();
  } finally {
    for (const logId of logIds) {
      await request.delete(`/api/v1/logs/${logId}`);
      expect((await request.get(`/api/v1/logs/${logId}`)).status()).toBe(404);
    }
    for (const note of [`${tag} hockey`, `${tag} swim`]) {
      const stray = await findLogId(note);
      if (stray) await request.delete(`/api/v1/logs/${stray}`);
    }
  }
});
