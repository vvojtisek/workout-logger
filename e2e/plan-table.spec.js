import { expect, test } from "@playwright/test";
import { clickAndAwaitWrite } from "./support/writes.js";

test("edits RIR, laterality and rest inline on a plan without horizontal scroll", async ({
  page,
  request,
}) => {
  const tag = `[E2E:${process.env.TEST_RUN_ID || Date.now()}:plan-table]`;
  const created = await request.post("/api/v1/plans", {
    data: {
      name: `${tag} plan`,
      exercises: [
        {
          exercise_name: `${tag} Split Squat`,
          target_sets: 3,
          target_reps_min: 8,
          target_reps_max: 10,
          target_weight_kg: 20,
          rest_time_seconds: 90,
          target_rir: 2,
          laterality: "per_side",
        },
        {
          exercise_name: `${tag} Row`,
          target_sets: 4,
          target_reps_min: 8,
          target_reps_max: 10,
          rest_time_seconds: 90,
        },
      ],
    },
  });
  expect(created.ok()).toBeTruthy();
  const plan = await created.json();

  try {
    await page.goto(`/plans/${plan.id}/edit`);
    await expect(page.getByRole("heading", { name: "Edit Program" })).toBeVisible();
    const rows = page.locator("#plan-exercises-list > div");
    await expect(rows).toHaveCount(2);

    // What the server stored is what the row shows.
    await expect(rows.nth(0).getByLabel("Target RIR")).toHaveValue("2");
    await expect(rows.nth(0).getByLabel("Laterality")).toHaveValue("per_side");
    await expect(rows.nth(1).getByLabel("Target RIR")).toHaveValue("");
    await expect(rows.nth(1).getByLabel("Laterality")).toHaveValue("bilateral");
    await expect(page.getByTestId("plan-summary")).toHaveText("2 exercises · 7 sets");

    // No unsaved-changes flag until something changes.
    await expect(page.getByText("Unsaved changes")).toBeHidden();
    await rows.nth(1).getByLabel("Target RIR").fill("0");
    await rows.nth(1).getByLabel("Laterality").selectOption("single_limb");
    await rows.nth(1).getByLabel("Rest seconds").fill("150");
    await rows.nth(1).getByLabel("Target sets").fill("5");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await expect(page.getByTestId("plan-summary")).toHaveText("2 exercises · 8 sets");

    // The editor never scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await clickAndAwaitWrite(page, page.getByRole("button", { name: "Save changes" }), "PUT");
    await expect(page.getByText("Unsaved changes")).toBeHidden();

    const read = await (await request.get(`/api/v1/plans/${plan.id}`)).json();
    expect(read.exercises[1]).toMatchObject({
      target_rir: 0,
      laterality: "single_limb",
      rest_time_seconds: 150,
      target_sets: 5,
    });
    expect(read.exercises[0]).toMatchObject({ target_rir: 2, laterality: "per_side" });
  } finally {
    await request.delete(`/api/v1/plans/${plan.id}`);
  }
});
