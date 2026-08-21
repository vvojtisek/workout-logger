import { expect, test } from "@playwright/test";

test("creates, reads, updates, displays, and deletes a real workout plan", async ({
  page,
  request,
}) => {
  const TEST_RUN_ID = process.env.TEST_RUN_ID || `e2e-${Date.now()}`;
  let planId;

  try {
    const created = await request.post("/api/v1/plans", {
      data: { name: `[E2E:${TEST_RUN_ID}] plan`, description: "created", exercises: [] },
    });
    expect(created.status()).toBe(201);
    planId = (await created.json()).id;

    const read = await request.get(`/api/v1/plans/${planId}`);
    expect(read.status()).toBe(200);

    const updated = await request.put(`/api/v1/plans/${planId}`, {
      data: { name: `[E2E:${TEST_RUN_ID}] updated`, description: "updated", exercises: [] },
    });
    expect(updated.status()).toBe(200);

    await page.addInitScript((key) => {
      localStorage.setItem("workout_logger_api_key", key);
    }, process.env.E2E_API_KEY || "");
    await page.goto("/");
    await page.getByRole("button", { name: "Plans" }).click();
    await expect(page.getByText(`[E2E:${TEST_RUN_ID}] updated`)).toBeVisible();
  } finally {
    if (planId) {
      await request.delete(`/api/v1/plans/${planId}`);
      expect((await request.get(`/api/v1/plans/${planId}`)).status()).toBe(404);
    }
  }
});
