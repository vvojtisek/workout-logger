import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("past workout compares repetitions at the same recorded load", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  let url = "";
  try {
    const logged = await request.post("/api/v1/logs", {
      data: {
        performed_at: new Date().toISOString(),
        total_time_minutes: 30,
        overall_feeling: 3,
        notes: tag,
        exercises: [{
          exercise_name: `${tag} Bench`,
          sets_count: 6,
          weight_per_set: [60, 50, 60, 50, 70, null],
          reps_per_set: [8, 10, 6, 12, 4, 8],
          rir_per_set: [2, null, 1, 0, null, null],
        }],
      },
    });
    expect(logged.status()).toBe(201);
    const { id } = await logged.json();
    url = `/api/v1/logs/${id}`;
    const read = await request.get(url);
    expect((await read.json()).exercises[0].weight_per_set).toEqual([60, 50, 60, 50, 70, null]);

    await page.goto(`/history/${id}`);
    const reveal = page.getByText("Rep retention at the same weight", { exact: true });
    await expect(reveal).toBeVisible();
    await reveal.click();
    await expect(page.getByText(/chart plots recorded reps/)).toBeVisible();
    await expect(page.getByRole("img", { name: "Rep retention at 60 kg" })).toBeVisible();
    const heavy = page.getByRole("table", { name: "Sets at 60 kg" });
    await expect(heavy.getByRole("row", { name: /^3 / }).getByRole("cell")).toHaveText([
      "6", "1", "7", "75%", "70%",
    ]);
    await page.getByLabel("Chart measure for 60 kg").selectOption("reps_at_failure");
    await expect(
      page.getByRole("img", { name: "Estimated reps at failure at 60 kg" }),
    ).toBeVisible();
    const light = page.getByRole("table", { name: "Sets at 50 kg" });
    await expect(light.getByRole("row", { name: /^4 / }).getByRole("cell")).toHaveText([
      "12", "0", "12", "120%", "100%",
    ]);
    await expect(page.getByRole("table", { name: "Sets at 70 kg" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      page.viewportSize()?.width,
    );
  } finally {
    if (url) {
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});
