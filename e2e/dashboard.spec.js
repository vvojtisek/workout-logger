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
          {
            // In the shared catalogue: primary muscle is triceps, nothing assists.
            exercise_name: "Triceps pushdown",
            sets_count: 4,
            reps_per_set: [10, 10, 10, 10],
            weight_kg: 30,
            rest_time_seconds: 60,
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
      analysis.getByTestId("session-metrics").filter({ hasText: "2,600 kg" }),
    ).toHaveText("7 sets · 2,600 kg · Best 100 kg × 5");

    // This week's bar holds at least this session's tonnage, and the split
    // credits the triceps with its four sets.
    const lastBar = analysis.getByTestId("volume-chart").locator("g").last();
    expect(Number(await lastBar.getAttribute("data-value"))).toBeGreaterThanOrEqual(2600);
    await analysis.getByRole("button", { name: "Sets", exact: true }).click();
    expect(Number(await lastBar.getAttribute("data-value"))).toBeGreaterThanOrEqual(7);
    const triceps = analysis.getByTestId("muscle-split").locator('[data-muscle="triceps"]');
    await expect(triceps).toBeVisible();
    expect(Number(await triceps.getAttribute("data-sets"))).toBeGreaterThanOrEqual(4);
    await analysis.getByRole("button", { name: "28 days", exact: true }).click();
    expect(Number(await triceps.getAttribute("data-sets"))).toBeGreaterThanOrEqual(4);

    // History rows carry the same numbers, and the range filter narrows the list.
    await openPage(page, "History");
    const list = page.locator("#history-list");
    const ours = list.getByTestId("session-metrics").filter({ hasText: "2,600 kg" });
    await expect(ours).toHaveText("7 sets · 2,600 kg · Best 100 kg × 5");
    await page.getByLabel("Date range").selectOption("7");
    await expect(ours).toHaveText("7 sets · 2,600 kg · Best 100 kg × 5");
    await page.getByLabel("Date range").selectOption("");
  } finally {
    if (logId) {
      await request.delete(`/api/v1/logs/${logId}`);
      expect((await request.get(`/api/v1/logs/${logId}`)).status()).toBe(404);
    }
  }
});
