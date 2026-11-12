import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("duplicates a plan without dropping its target RIR", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  /** @type {string | undefined} */
  let planId;
  /** @type {string | undefined} */
  let copyId;

  try {
    const created = await request.post("/api/v1/plans", {
      data: {
        name: `${tag} strength plan`,
        exercises: [
          {
            exercise_name: `${tag} squat`,
            target_sets: 3,
            target_reps_min: 5,
            target_reps_max: 8,
            target_rir: 2,
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    planId = (await created.json()).id;

    await page.goto("/plans");
    const planCard = page.getByRole("listitem").filter({ hasText: `${tag} strength plan` });
    const [duplicated] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/v1/plans"),
      ),
      planCard.getByRole("button", { name: "Duplicate" }).click(),
    ]);
    expect(duplicated.status()).toBe(201);
    const copy = await duplicated.json();
    copyId = copy.id;
    expect(copy.exercises[0]).toMatchObject({
      exercise_name: `${tag} squat`,
      target_rir: 2,
    });
  } finally {
    if (copyId) expect((await request.delete(`/api/v1/plans/${copyId}`)).status()).toBe(204);
    if (planId) expect((await request.delete(`/api/v1/plans/${planId}`)).status()).toBe(204);
  }
});
