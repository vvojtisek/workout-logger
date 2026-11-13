import { expect, test } from "@playwright/test";

import { isDesktop, openPage } from "./support/navigation.js";

test("desktop Today is a two-column dashboard and History shows what each session amounted to", async ({
  page,
  request,
}) => {
  test.skip(!isDesktop(page), "The dashboard is the desktop layout");
  const tag = `[E2E:${process.env.TEST_RUN_ID || `dash-${Date.now()}`}:dash]`;
  /** @type {string | undefined} */
  let logId;

  try {
    page.setDefaultTimeout(5_000);
    const created = await request.post("/api/v1/logs", {
      data: {
        performed_at: new Date(Date.now() - 3_600_000).toISOString(),
        total_time_minutes: 45,
        overall_feeling: 4,
        notes: `${tag} dashboard fixture`,
        exercises: [
          {
            exercise_name: `${tag} Bench`,
            sets_count: 3,
            reps_per_set: [5, 5, 4],
            weight_kg: 100,
            rest_time_seconds: 90,
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    logId = (await created.json()).id;

    await page.goto("/");
    await openPage(page, "Today");

    // Main column and analysis panels sit side by side, not stacked.
    const main = page.locator("#today-main");
    const analysis = page.getByRole("complementary", { name: "Training analysis" });
    await expect(analysis).toBeVisible();
    const mainBox = await main.boundingBox();
    const analysisBox = await analysis.boundingBox();
    expect((analysisBox?.x ?? 0)).toBeGreaterThan((mainBox?.x ?? 0) + (mainBox?.width ?? 0));
    await expect(analysis.getByRole("heading", { name: "Recent sessions" })).toBeVisible();
    await expect(
      analysis.getByTestId("session-metrics").filter({ hasText: "1,400 kg" }),
    ).toHaveText("3 sets · 1,400 kg · Best 100 kg × 5");

    // History rows carry the same numbers, and the range filter narrows the list.
    await openPage(page, "History");
    const list = page.locator("#history-list");
    const ours = list.getByTestId("session-metrics").filter({ hasText: "1,400 kg" });
    await expect(ours).toHaveText("3 sets · 1,400 kg · Best 100 kg × 5");
    await page.getByLabel("Date range").selectOption("7");
    await expect(ours).toHaveText("3 sets · 1,400 kg · Best 100 kg × 5");
    await page.getByLabel("Date range").selectOption("");
  } finally {
    if (logId) {
      await request.delete(`/api/v1/logs/${logId}`);
      expect((await request.get(`/api/v1/logs/${logId}`)).status()).toBe(404);
    }
  }
});
