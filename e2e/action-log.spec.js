import { expect, test } from "@playwright/test";
import { openPage } from "./support/navigation.js";

test("the admin sees a write in the action log with who made it", async ({ page, request }) => {
  page.setDefaultTimeout(5_000);
  const name = `E2E action log ${Date.now()}`;
  const created = await request.post("/api/v1/plans", { data: { name, exercises: [] } });
  expect(created.status()).toBe(201);
  const plan = await created.json();

  try {
    const response = await request.get("/api/v1/audit-events?actor_kind=user&limit=200");
    expect(response.status()).toBe(200);
    /** @type {{items: Array<{params: Record<string, unknown>}>}} */
    const log = await response.json();
    const entry = log.items.find((item) => item.params.name === name);
    expect(entry).toMatchObject({
      action: "POST /api/v1/plans",
      actor_kind: "user",
      target_id: plan.id,
      outcome: "success",
    });

    await page.goto("/");
    await openPage(page, "Settings");
    const row = page.locator("#action-log li", { hasText: name });
    await expect(row).toContainText("POST plans");
    await expect(row).toContainText("(App user)");
    await expect(row).toContainText("done (201)");
  } finally {
    const deleted = await request.delete(`/api/v1/plans/${plan.id}`);
    expect(deleted.status()).toBe(204);
  }
});
