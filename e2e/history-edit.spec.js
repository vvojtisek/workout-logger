import { expect, test } from "@playwright/test";
import { clickAndAwaitWrite } from "./support/writes.js";

test("edits a past workout's date, notes, exercises and sets from its history page", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `history-edit-${Date.now()}`;
  const tag = `[E2E:${TEST_RUN_ID}:history-edit]`;
  /** @type {string | null} */
  let logId = null;

  try {
    page.setDefaultTimeout(5_000);
    const created = await request.post("/api/v1/logs", {
      data: {
        performed_at: "2033-03-10T07:00:00Z",
        total_time_minutes: 35,
        overall_feeling: 3,
        notes: `${tag} before`,
        exercises: [
          {
            exercise_name: "Bench press",
            sets_count: 2,
            reps_per_set: [8, 8],
            weight_per_set: [60, 60],
            rir_per_set: [3, 2],
          },
          { exercise_name: "Plank", sets_count: 1, reps_per_set: [1] },
        ],
      },
    });
    expect(created.status()).toBe(201);
    logId = (await created.json()).id;

    await page.goto(`/history/${logId}`);
    await expect(page.locator("#detail-content")).toContainText("Bench press: 8, 8 reps @ 60kg");
    await page.locator("#edit-log-btn").click();
    await expect(page.getByRole("heading", { name: "Edit Workout", exact: true })).toBeVisible();

    await page.locator("#edit-performed-at").fill("2033-03-11 18:15");
    await page.locator("#edit-notes").fill(`${tag} after`);
    await page.locator("#edit-feeling").selectOption("5");

    // Second bench set goes up to 62.5 kg at 6 reps, a third set is added
    // as a copy and its reps lowered, and the RIR of set 1 is cleared.
    await page.getByLabel("Bench press set 2 Weight (kg)").fill("62.5");
    await page.getByLabel("Bench press set 2 Repetitions").fill("6");
    await page.getByLabel("Bench press set 1 RIR").selectOption("");
    const bench = page.locator("#log-edit-form .card").filter({ has: page.getByLabel("Bench press set 1 RIR") });
    await bench.getByRole("button", { name: "+ Add set" }).click();
    await page.getByLabel("Bench press set 3 Repetitions").fill("5");
    await page.getByLabel("Bench press set 3 RIR").selectOption("0");
    await expect(page.getByLabel("Bench press set 3 RIR")).toContainText("no reps left (failure)");

    // Plank goes; a row exercise comes in.
    const plank = page.locator("#log-edit-form .card").filter({ has: page.getByLabel("Plank set 1 RIR") });
    await plank.getByRole("button", { name: "Remove exercise" }).click();
    await page.locator("#edit-add-exercise").click();
    await page.locator("#edit-exercise-name-1").fill("Seated row");
    await page.getByLabel("Seated row set 1 Weight (kg)").fill("45");
    await page.getByLabel("Seated row set 1 Repetitions").fill("12");

    // A set without reps is caught before anything is sent.
    await page.getByLabel("Seated row set 1 Repetitions").fill("");
    await page.locator("#save-log-btn").click();
    await expect(page.locator("#log-edit-error")).toHaveText(/Seated row set 1: reps/);
    await page.getByLabel("Seated row set 1 Repetitions").fill("12");

    await clickAndAwaitWrite(page, page.locator("#save-log-btn"), "PATCH");
    await expect(page.getByRole("heading", { name: "Workout Detail", exact: true })).toBeVisible();
    await expect(page.locator("#detail-content")).toContainText(
      "Bench press: 60 kg × 8, 62.5 kg × 6, 62.5 kg × 5"
    );
    await expect(page.locator("#detail-content")).toContainText("Seated row: 12 reps @ 45kg");
    await expect(page.locator("#detail-content")).not.toContainText("Plank");

    const stored = await (await request.get(`/api/v1/logs/${logId}`)).json();
    expect(stored).toMatchObject({
      notes: `${tag} after`,
      overall_feeling: 5,
      total_time_minutes: 35,
      exercises: [
        {
          exercise_name: "Bench press",
          sets_count: 3,
          reps_per_set: [8, 6, 5],
          weight_per_set: [60, 62.5, 62.5],
          rir_per_set: [null, 2, 0],
          weight_kg: 62.5,
        },
        { exercise_name: "Seated row", reps_per_set: [12], weight_per_set: [45], weight_kg: 45 },
      ],
    });
    expect(new Date(stored.performed_at).getTime()).toBe(new Date(2033, 2, 11, 18, 15).getTime());
  } finally {
    if (logId) {
      await request.delete(`/api/v1/logs/${logId}`);
      expect((await request.get(`/api/v1/logs/${logId}`)).status()).toBe(404);
    }
  }
});
