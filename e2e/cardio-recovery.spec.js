import { expect, test } from "@playwright/test";

import { isDesktop, openLogSheet, openPage } from "./support/navigation.js";
import { clickAndAwaitWrite } from "./support/writes.js";

// Cardio and recovery quick logging against the real app and database:
// the form opens pre-filled from the same weekday in recent weeks, so a
// retrospective hockey game takes four taps, and a repeated sauna routine
// is one tap that is saved, linked to the swim before it, and undoable.

const pad = (/** @type {number} */ value) => String(value).padStart(2, "0");

/** @param {Date} date */
function localIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {Date} day @param {number} hour @param {number} minute */
function at(day, hour, minute) {
  const value = new Date(day);
  value.setHours(hour, minute, 0, 0);
  return value;
}

/** @param {number} days */
function daysAgo(days) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() - days);
  return value;
}

/**
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {Record<string, unknown>} body
 * @returns {Promise<string>}
 */
async function createLog(request, body) {
  const response = await request.post("/api/v1/logs", { data: body });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id;
}

/**
 * @param {import("@playwright/test").APIRequestContext} request
 * @param {string[]} ids
 */
async function removeLogs(request, ids) {
  for (const id of ids) {
    await request.delete(`/api/v1/logs/${id}`);
    expect((await request.get(`/api/v1/logs/${id}`)).status()).toBe(404);
  }
}

test("a retrospective hockey game takes four taps from the Log button", async ({ page, request }) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || `cardio-${Date.now()}`}:cardio]`;
  /** @type {string[]} */
  const logIds = [];
  try {
    page.setDefaultTimeout(5_000);
    // Four weeks of hockey on yesterday's weekday at 19:30, 75 min, effort 4.
    for (const weeks of [1, 2, 3, 4]) {
      const day = daysAgo(1 + 7 * weeks);
      logIds.push(
        await createLog(request, {
          performed_at: at(day, 19, 30).toISOString(),
          total_time_minutes: 75,
          overall_feeling: 3,
          activity_type: "ice_hockey",
          effort_level: 4,
          notes: `${tag} league`,
        }),
      );
    }

    await page.goto("/");
    let taps = 0;
    if (isDesktop(page)) {
      await openPage(page, "Cardio");
    } else {
      await openLogSheet(page);
      taps += 1;
      await page.getByRole("dialog", { name: "Log" }).getByRole("link", { name: "Cardio", exact: true }).click();
      taps += 1;
    }
    await expect(page.getByRole("heading", { name: "Log cardio", exact: true })).toBeVisible();

    await page.getByTestId("cardio-day").getByRole("button", { name: "Yesterday", exact: true }).click();
    taps += 1;

    // The prediction for yesterday's weekday fills every required field.
    const form = page.getByTestId("cardio-form");
    await expect(form.getByTestId("cardio-type").getByRole("button", { name: "Ice hockey" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(form.getByTestId("cardio-time").getByRole("button", { name: "19:30" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(form.getByTestId("cardio-duration").getByRole("button", { name: "75m" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(form.getByTestId("cardio-effort").getByRole("button", { name: "4 Hard" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Feel before/after is optional and starts empty.
    await expect(form.getByTestId("cardio-feel-after").locator("[aria-pressed=true]")).toHaveCount(0);

    const saved = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/coach/log"),
    );
    await form.getByRole("button", { name: "Save ice hockey" }).click();
    taps += 1;
    const result = await (await saved).json();
    logIds.push(result.workout_log.id);
    if (!isDesktop(page)) expect(taps).toBeLessThan(5);

    await expect(page.getByText("Ice hockey logged")).toBeVisible();
    const stored = await (await request.get(`/api/v1/logs/${result.workout_log.id}`)).json();
    expect(stored).toMatchObject({
      activity_type: "ice_hockey",
      activity_category: "cardio",
      total_time_minutes: 75,
      effort_level: 4,
      effort_rpe: 7,
      feel_before: null,
      feel_after: null,
    });
    expect(new Date(stored.performed_at).getTime()).toBe(at(daysAgo(1), 19, 30).getTime());
  } finally {
    await removeLogs(request, logIds);
  }
});

test("optional before and after feel are saved when tapped", async ({ page, request }) => {
  /** @type {string[]} */
  const logIds = [];
  try {
    page.setDefaultTimeout(5_000);
    await page.goto("/");
    await openPage(page, "Cardio");
    const form = page.getByTestId("cardio-form");
    await form.getByTestId("cardio-type").getByRole("button", { name: "Cycling" }).click();
    await form.getByTestId("cardio-duration").getByRole("button", { name: "60m" }).click();
    await form.getByTestId("cardio-effort").getByRole("button", { name: "3 Moderate" }).click();
    await form.getByTestId("cardio-feel-before").getByRole("button", { name: "Fresh" }).click();
    await form.getByTestId("cardio-feel-after").getByRole("button", { name: "Fatigued" }).click();
    // Tapping a chosen feel again clears it; tap it back on.
    await form.getByTestId("cardio-feel-after").getByRole("button", { name: "Fatigued" }).click();
    await expect(form.getByTestId("cardio-feel-after").getByRole("button", { name: "Fatigued" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await form.getByTestId("cardio-feel-after").getByRole("button", { name: "Fatigued" }).click();

    const saved = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/coach/log"),
    );
    await form.getByRole("button", { name: "Save cycling" }).click();
    const result = await (await saved).json();
    logIds.push(result.workout_log.id);
    expect(result.workout_log).toMatchObject({
      activity_type: "cycling",
      total_time_minutes: 60,
      effort_level: 3,
      feel_before: 5,
      feel_after: 2,
      overall_feeling: 2,
    });
  } finally {
    await removeLogs(request, logIds);
  }
});

test("a repeated sauna routine logs in one tap, links to the swim and can be undone", async ({ page, request }) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || `recovery-${Date.now()}`}:recovery]`;
  /** @type {string[]} */
  const logIds = [];
  try {
    page.setDefaultTimeout(5_000);
    const swimId = await createLog(request, {
      // Just now, so it is the latest training session before the tap.
      performed_at: new Date(Date.now() - 30_000).toISOString(),
      total_time_minutes: 30,
      overall_feeling: 4,
      activity_type: "swimming",
      effort_level: 2,
      notes: `${tag} swim`,
    });
    logIds.push(swimId);

    await page.goto("/");
    await openPage(page, "Recovery");
    await expect(page.getByRole("heading", { name: "Log recovery", exact: true })).toBeVisible();
    const card = page.getByTestId("recovery-preset").filter({ hasText: "Sauna · 3 cycles" });
    await expect(card).toContainText("after swimming");

    // The single tap is the whole interaction.
    const saved = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/coach/log"),
    );
    await card.click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const sauna = (await response.json()).workout_log;
    logIds.push(sauna.id);

    const stored = await (await request.get(`/api/v1/logs/${sauna.id}`)).json();
    expect(stored).toMatchObject({
      activity_type: "sauna",
      activity_category: "recovery",
      cycles: 3,
      sauna_rounds: 3,
      total_time_minutes: 45,
      effort_rpe: null,
      linked_log_id: swimId,
    });
    const recovery = await (
      await request.get(`/api/v1/logs?category=recovery&date_from=${encodeURIComponent(at(new Date(), 0, 0).toISOString())}`)
    ).json();
    expect(recovery.items.map((/** @type {{id: string}} */ item) => item.id)).toContain(sauna.id);
    await expect(page.getByTestId("recovery-today")).toContainText("Sauna");
    await expect(page.getByTestId("recovery-today")).toContainText("3 cycles");

    // Undo from the toast removes it again.
    const toastUndo = page.getByRole("status").filter({ hasText: "Sauna · 3 cycles logged" }).getByRole("button", {
      name: "Undo",
    });
    await clickAndAwaitWrite(page, toastUndo, "DELETE");
    expect((await request.get(`/api/v1/logs/${sauna.id}`)).status()).toBe(404);
    await expect(page.getByText("Sauna · 3 cycles removed")).toBeVisible();
  } finally {
    await removeLogs(request, logIds);
  }
});

test("the recovery form saves a cold plunge with cycles and no link", async ({ page, request }) => {
  /** @type {string[]} */
  const logIds = [];
  try {
    page.setDefaultTimeout(5_000);
    await page.goto("/");
    await openPage(page, "Recovery");
    const form = page.getByTestId("recovery-form");
    await form.getByTestId("recovery-type").getByRole("button", { name: "Cold plunge" }).click();
    await form.getByRole("button", { name: "More cycles" }).click();
    await form.getByRole("button", { name: "More cycles" }).click();
    const linkGroup = form.getByTestId("recovery-link");
    if (await linkGroup.count()) await linkGroup.getByRole("button", { name: "Nothing" }).click();

    const saved = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/coach/log"),
    );
    await form.getByRole("button", { name: "Save cold plunge" }).click();
    const log = (await (await saved).json()).workout_log;
    logIds.push(log.id);
    expect(log).toMatchObject({ activity_type: "cold_plunge", activity_category: "recovery", linked_log_id: null });
    expect(log.cycles).toBeGreaterThanOrEqual(2);
    expect(localIso(new Date(log.performed_at))).toBe(localIso(new Date()));
  } finally {
    await removeLogs(request, logIds);
  }
});


test("hot tub and massage can be logged and repeated from Recovery", async ({ page, request }) => {
  /** @type {string[]} */
  const ids = [];
  page.setDefaultTimeout(5000);
  const tag = `[E2E:${process.env.TEST_RUN_ID || Date.now()}:new-recovery]`;
  try {
    const trainingId = await createLog(request, {
      performed_at: at(new Date(), 0, 0).toISOString(),
      total_time_minutes: 15,
      overall_feeling: 3,
      activity_type: "swimming",
      notes: tag,
    });
    ids.push(trainingId);
    await page.goto("/recovery");
    const form = page.getByTestId("recovery-form");
    for (const [kind, label, minutes] of [
      ["hot_tub", "Hot tub (Jacuzzi)", "15"],
      ["massage", "Massage", "30"],
    ]) {
      await form.getByTestId("recovery-type").getByRole("button", { name: label, exact: true }).click();
      await expect(form.getByLabel("Duration in minutes")).toHaveValue(minutes);
      await form
        .getByTestId("recovery-link")
        .getByRole("button", { name: "After Swimming 00:00", exact: true })
        .click();
      const saved = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/coach/log"),
      );
      await form.getByRole("button", { name: `Save ${label.toLowerCase()}` }).click();
      const log = (await (await saved).json()).workout_log;
      ids.push(log.id);
      expect(log).toMatchObject({
        activity_type: kind,
        activity_category: "recovery",
        effort_rpe: null,
        linked_log_id: trainingId,
      });
      await expect(page.getByTestId("recovery-today")).toContainText(label);
      await page
        .getByRole("status")
        .filter({ hasText: `${label} logged` })
        .getByRole("button", { name: "Dismiss" })
        .click();
    }
    // Predictions use completed days. Open tomorrow's form to repeat a saved routine.
    const tomorrow = daysAgo(-1);
    await page.clock.setFixedTime(tomorrow);
    await page.reload();
    const preset = page.getByTestId("recovery-preset").filter({ hasText: "Massage · 30 min" });
    await expect(page.getByTestId("recovery-preset").filter({ hasText: "Hot tub (Jacuzzi)" })).toBeVisible();
    const repeated = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/coach/log"),
    );
    await preset.click();
    const log = (await (await repeated).json()).workout_log;
    ids.push(log.id);
    expect(log).toMatchObject({
      activity_type: "massage",
      activity_category: "recovery",
      total_time_minutes: 30,
    });
  } finally {
    await removeLogs(request, ids.reverse());
  }
});
