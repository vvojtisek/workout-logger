import { expect, test } from "@playwright/test";
import { detailPane, isDesktop, openPage } from "./support/navigation.js";

test("history opens a workout beside the list on desktop and as its own screen on a phone", async ({
  page,
  request,
}) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || `md-${Date.now()}`}:md]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let logId;

  try {
    page.setDefaultTimeout(5_000);
    const plan = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} plan`,
        description: tag,
        exercises: [
          {
            exercise_name: `${tag} Goblet Squat`,
            target_sets: 3,
            target_reps_min: 10,
            target_reps_max: 10,
            target_weight_kg: 20,
            rest_time_seconds: 60,
          },
        ],
      },
    });
    expect(plan.status()).toBe(201);
    planId = (await plan.json()).id;
    const created = await request.post("/api/v1/logs", {
      data: {
        source_plan_id: planId,
        performed_at: new Date(Date.now() - 3_600_000).toISOString(),
        total_time_minutes: 25,
        overall_feeling: 3,
        notes: tag,
        exercises: [
          {
            exercise_name: `${tag} Goblet Squat`,
            sets_count: 3,
            reps_per_set: [10, 10, 10],
            weight_kg: 20,
            rest_time_seconds: 60,
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    logId = (await created.json()).id;

    await page.goto("/");
    await openPage(page, "History");
    const list = page.locator("#history-list");
    if (isDesktop(page)) {
      await expect(detailPane(page)).toContainText("Pick a workout to see what was logged.");
    }
    await list.getByRole("button").filter({ hasText: `${tag} plan` }).click();
    await expect(page).toHaveURL(new RegExp(`/history/${logId}$`));
    await expect(detailPane(page).getByText(`${tag} Goblet Squat`)).toBeVisible();

    if (isDesktop(page)) {
      // The list stays beside the open workout, with that workout marked.
      await expect(page.getByRole("heading", { name: "Workout History" })).toBeVisible();
      await expect(list.locator('[aria-current="true"]')).toContainText(`${tag} plan`);
      expect((await page.getByTestId("master-pane").boundingBox())?.width).toBe(340);
    } else {
      // On a phone the workout replaces the list.
      await expect(list).toHaveCount(0);
    }

    // Deleting from the detail returns to a list that no longer has it.
    await detailPane(page).getByRole("button", { name: "Delete workout" }).click();
    await page
      .getByRole("dialog", { name: "Delete workout" })
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(list.getByRole("button").filter({ hasText: `${tag} plan` })).toHaveCount(0);
    expect((await request.get(`/api/v1/logs/${logId}`)).status()).toBe(404);
    logId = undefined;
  } finally {
    if (logId) await request.delete(`/api/v1/logs/${logId}`);
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
