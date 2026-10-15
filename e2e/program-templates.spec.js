import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";

const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Leaves exactly the given weekdays (Monday = 0) pressed on a template card.
 * @param {import("@playwright/test").Locator} card
 * @param {number[]} weekdays
 */
async function chooseWeekdays(card, weekdays) {
  for (const label of LABELS) {
    const day = card.getByRole("button", { name: label, exact: true });
    if ((await day.getAttribute("aria-pressed")) === "true") await day.click();
  }
  for (const weekday of weekdays) {
    await card.getByRole("button", { name: LABELS[weekday], exact: true }).click();
  }
}

test("adds, removes and restarts the ready-made local gym program through the GUI", async ({
  page,
  request,
}) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  // The API numbers weekdays from Monday = 0; the calendar view works in UTC.
  const todayWeekday = (now.getUTCDay() + 6) % 7;
  const laterWeekday = (todayWeekday + 3) % 7;
  /** @type {string | undefined} */
  let programId;
  /** @type {string[]} */
  let planIds = [];

  try {
    page.setDefaultTimeout(5_000);
    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");
    await page.goto("/");
    await openPage(page, "Programs");

    const card = page.getByRole("listitem", { name: /^Local gym A\/B/ });
    await expect(card).toBeVisible();
    await card.getByLabel("First session on or after").fill(today);
    await chooseWeekdays(card, [todayWeekday, laterWeekday]);
    await card.getByRole("button", { name: "Start this program" }).click();

    const programRow = page.locator("#programs-list").getByText(/^Local gym A\/B/);
    await expect(programRow).toBeVisible();
    const programs = await request.get("/api/v1/programs?limit=100");
    /** @type {{items: Array<{id: string, name: string, start_date: string}>}} */
    const programsBody = await programs.json();
    const program = programsBody.items.find((item) => item.name.startsWith("Local gym A/B"));
    expect(program?.start_date).toBe(today);
    programId = program?.id;

    // Twelve sessions at two a week fit well inside 100 days.
    const until = new Date(now.getTime() + 100 * 86_400_000).toISOString().slice(0, 10);
    const calendar = await request.get(`/api/v1/calendar?from=${today}&to=${until}`);
    expect(calendar.status()).toBe(200);
    /** @type {{items: Array<{program_id: string, workout_plan_id: string, workout_plan_name: string, notes: string, scheduled_date: string}>}} */
    const calendarBody = await calendar.json();
    const sessions = calendarBody.items.filter((item) => item.program_id === programId);
    expect(sessions).toHaveLength(12);
    expect(sessions[0]).toMatchObject({ scheduled_date: today });
    expect(sessions[0].notes).toMatch(/^Session 1 of 12/);
    planIds = [...new Set(sessions.map((item) => item.workout_plan_id))];
    expect(planIds).toHaveLength(2);

    // Adding it a second time is refused instead of duplicating the plans.
    await card.getByRole("button", { name: "Start this program" }).click();
    await expect(page.getByText(/names already exist/)).toBeVisible();

    // The calendar entry shows that session's instructions.
    await openPage(page, "Calendar");
    await page.getByRole("button", { name: sessions[0].workout_plan_name }).first().click();
    await expect(page.getByRole("dialog").locator(".scheduled-notes")).toContainText(
      "Session 1 of 12: Establish comfortable ranges",
    );

    // Removing it clears its calendar sessions and plans, so it can start again later.
    await page.goto("/programs");
    const row = page.locator("#programs-list").getByRole("listitem", { name: /^Local gym A\/B/ });
    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(row).toBeHidden();
    for (const planId of planIds) {
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
    const cleared = await request.get(`/api/v1/calendar?from=${today}&to=${until}`);
    /** @type {{items: Array<{program_id: string}>}} */
    const clearedBody = await cleared.json();
    expect(clearedBody.items.filter((item) => item.program_id === programId)).toHaveLength(0);
    programId = undefined;

    const nextWeek = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    await card.getByLabel("First session on or after").fill(nextWeek);
    await chooseWeekdays(card, [todayWeekday, laterWeekday]);
    await card.getByRole("button", { name: "Start this program" }).click();
    await expect(row).toBeVisible();
    const restarted = await request.get("/api/v1/programs?limit=100");
    /** @type {{items: Array<{id: string, name: string, start_date: string}>}} */
    const restartedBody = await restarted.json();
    const again = restartedBody.items.find((item) => item.name.startsWith("Local gym A/B"));
    expect(again?.start_date).toBe(nextWeek);
    programId = again?.id;
  } finally {
    if (!programId) {
      const programs = await request.get("/api/v1/programs?limit=100");
      if (programs.status() === 200) {
        /** @type {{items: Array<{id: string, name: string}>}} */
        const body = await programs.json();
        programId = body.items.find((item) => item.name.startsWith("Local gym A/B"))?.id;
      }
    }
    if (programId) {
      await request.delete(`/api/v1/programs/${programId}`);
      expect((await request.get(`/api/v1/programs/${programId}`)).status()).toBe(404);
    }
    const plans = await request.get("/api/v1/plans?limit=100");
    if (plans.status() === 200) {
      /** @type {{items: Array<{id: string, name: string}>}} */
      const body = await plans.json();
      for (const plan of body.items.filter((item) => item.name.startsWith("Local gym "))) {
        planIds.push(plan.id);
      }
    }
    for (const planId of new Set(planIds)) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
