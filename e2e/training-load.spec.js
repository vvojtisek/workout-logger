import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { clickAndAwaitWrite } from "./support/writes.js";

test.use({ timezoneId: "Europe/Prague" });

test("training load separates weekly session effort by activity type", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const cleanup = [];
  try {
    for (const [day, activity_type, minutes, effort_rpe] of [
      ["2024-02-05", null, 30, 6],
      ["2024-02-06", "running", 20, 5],
      ["2024-02-07", "cycling", 40, null],
    ]) {
      const log = await request.post("/api/v1/logs", {
        data: {
          performed_at: `${day}T12:00:00Z`,
          total_time_minutes: minutes,
          overall_feeling: 3,
          effort_rpe,
          activity_type,
          notes: tag,
        },
      });
      expect(log.status()).toBe(201);
      cleanup.push(`/api/v1/logs/${(await log.json()).id}`);
    }

    await page.goto("/training-load");
    await page.getByLabel("Week containing").fill("2024-02-11");
    await page.getByLabel("Weeks to show").selectOption("4");
    const breakdown = page.getByRole("table", { name: "Weekly session effort by activity" });
    await page.getByLabel("Activity breakdown week").selectOption("2024-02-05");
    await expect(breakdown.getByRole("row", { name: /^Strength training/ }).getByRole("cell"))
      .toHaveText(["1 / 1", "30", "180 AU"]);
    await expect(breakdown.getByRole("row", { name: /^Running/ }).getByRole("cell"))
      .toHaveText(["1 / 1", "20", "100 AU"]);
    await expect(breakdown.getByRole("row", { name: /^Cycling/ }).getByRole("cell"))
      .toHaveText(["0 / 1", "0", "No ratings"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      page.viewportSize()?.width,
    );
  } finally {
    for (const url of cleanup) {
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});

test("training monotony and strain summarize seven rated local days", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const cleanup = [];
  try {
    for (const day of ["2026-10-19", "2026-10-21"]) {
      const log = await request.post("/api/v1/logs", {
        data: {
          performed_at: `${day}T12:00:00Z`,
          total_time_minutes: 10,
          overall_feeling: 3,
          effort_rpe: 7,
          activity_type: "running",
          notes: tag,
        },
      });
      expect(log.status()).toBe(201);
      cleanup.push(`/api/v1/logs/${(await log.json()).id}`);
    }

    await page.goto("/training-load");
    await page.getByLabel("Week containing").fill("2026-10-25");
    await page.getByLabel("Weeks to show").selectOption("4");
    const metrics = page.getByRole("region", { name: "Weekly training monotony and strain" });
    await expect(metrics).toContainText("Daily mean");
    await expect(metrics).toContainText("20 AU/day");
    await expect(metrics).toContainText("31.62 AU/day");
    await expect(metrics).toContainText("0.63");
    await expect(metrics).toContainText("88.54 AU");
    const dailyLoads = metrics.getByRole("table", { name: "Daily training load" });
    await expect(dailyLoads.getByRole("row")).toHaveCount(8);
    await expect(dailyLoads.getByRole("row", { name: "2026-10-19 70 AU" })).toBeVisible();
    await expect(dailyLoads.getByRole("row", { name: "2026-10-20 0 AU" })).toBeVisible();
    await expect(dailyLoads.getByRole("row", { name: "2026-10-21 70 AU" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      page.viewportSize()?.width,
    );
  } finally {
    for (const url of cleanup) {
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});

test("training load reviews recorded gym work by week", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const cleanup = [];
  let latestGymLog = "";

  try {
    const exercise = await request.post("/api/v1/exercises", {
      data: {
        name: `${tag} Press`,
        primary_muscles: ["chest", "triceps"],
        secondary_muscles: ["shoulders"],
      },
    });
    expect(exercise.status()).toBe(201);
    cleanup.push(`/api/v1/exercises/${(await exercise.json()).id}`);
    for (const [performedAt, exerciseName] of [
      ["2026-10-18T21:59:59Z", `${tag} Unknown press`],
      ["2026-10-18T22:00:00Z", `${tag} Press`],
    ]) {
      const isClassified = exerciseName === `${tag} Press`;
      const log = await request.post("/api/v1/logs", {
        data: {
          performed_at: performedAt,
          total_time_minutes: 30,
          overall_feeling: 3,
          notes: tag,
          exercises: [{
            exercise_name: exerciseName,
            sets_count: isClassified ? 4 : 2,
            weight_per_set: isClassified ? [50, 25, 0, 0] : [50, 25],
            reps_per_set: isClassified ? [3, 8, 10, 8] : [3, 8],
          }],
        },
      });
      expect(log.status()).toBe(201);
      const { id } = await log.json();
      cleanup.push(`/api/v1/logs/${id}`);
      latestGymLog = id;
    }
    const activity = await request.post("/api/v1/logs", {
      data: {
        performed_at: "2026-10-21T12:00:00Z",
        total_time_minutes: 40,
        overall_feeling: 3,
        effort_rpe: 4,
        activity_type: "running",
        notes: tag,
      },
    });
    expect(activity.status()).toBe(201);
    cleanup.push(`/api/v1/logs/${(await activity.json()).id}`);

    await page.goto("/history");
    const trainingLoad = page.getByRole("link", { name: "Training load", exact: true });
    await expect(trainingLoad).toBeVisible();
    await trainingLoad.click();
    await expect(page.getByRole("heading", { name: "Training load", exact: true })).toBeVisible();
    await page.getByLabel("Week containing").fill("2026-10-25");
    await page.getByLabel("Weeks to show").selectOption("4");

    const table = page.getByRole("table", { name: "Weekly gym work" });
    const latest = table.getByRole("row", { name: /^2026-10-19/ });
    await expect(latest.getByRole("cell")).toHaveText(["1", "4", "350 kg"]);
    await expect(table.getByRole("row", { name: /^2026-10-12/ }).getByRole("cell")).toHaveText([
      "1", "2", "350 kg",
    ]);
    await expect(table.getByRole("row")).toHaveCount(5);
    const breakdown = page.getByRole("table", { name: "Primary-muscle sets and external volume" });
    await expect(breakdown.getByRole("row", { name: /^Chest/ }).getByRole("cell"))
      .toHaveText(["4", "175 kg"]);
    await expect(breakdown.getByRole("row", { name: /^Triceps/ }).getByRole("cell"))
      .toHaveText(["4", "175 kg"]);
    await expect(breakdown.getByRole("row", { name: /^Shoulders/ })).toHaveCount(0);
    await page.getByLabel("Muscle breakdown week").selectOption("2026-10-12");
    await expect(breakdown.getByRole("row", { name: /^Unclassified/ }).getByRole("cell"))
      .toHaveText(["2", "350 kg"]);

    const effort = page.getByRole("table", { name: "Weekly session effort" });
    const latestEffort = effort.getByRole("row", { name: /^2026-10-19/ });
    await expect(latestEffort.getByRole("cell")).toHaveText(["1 / 2", "40", "160 AU"]);
    await expect(effort.getByRole("row", { name: /^2026-10-12/ })).toContainText("No ratings");
    await expect(effort.getByRole("row", { name: /^2026-10-05/ })).toContainText("No sessions");
    await expect(page.getByRole("region", { name: "Weekly training monotony and strain" }))
      .toContainText("Every session needs a whole-session RPE and positive duration.");

    await page.goto(`/history/${latestGymLog}`);
    await page.getByRole("button", { name: "Edit workout" }).click();
    await page.getByLabel("Session effort (optional)").selectOption("6");
    await clickAndAwaitWrite(page, page.getByRole("button", { name: "Save changes" }), "PATCH");
    const rated = await request.get(`/api/v1/logs/${latestGymLog}`);
    expect((await rated.json()).effort_rpe).toBe(6);
    await page.getByRole("link", { name: "Training load", exact: true }).click();
    await page.getByLabel("Week containing").fill("2026-10-25");
    await expect(latestEffort.getByRole("cell")).toHaveText(["2 / 2", "70", "340 AU"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      page.viewportSize()?.width,
    );
  } finally {
    for (const url of cleanup.reverse()) {
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});

test("workload ratio reports the selected week and its preceding baseline", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const cleanup = [];
  try {
    for (const [day, minutes, rating] of [
      ["2024-01-08", 20, 2],
      ["2024-01-15", 20, 4],
      ["2024-01-22", 20, 6],
      ["2024-01-29", 20, 8],
      ["2024-02-05", 30, 6],
    ]) {
      const log = await request.post("/api/v1/logs", {
        data: {
          performed_at: `${day}T12:00:00Z`,
          total_time_minutes: minutes,
          overall_feeling: 3,
          effort_rpe: rating,
          activity_type: "running",
          notes: tag,
        },
      });
      expect(log.status()).toBe(201);
      cleanup.push(`/api/v1/logs/${(await log.json()).id}`);
    }
    await page.goto("/training-load");
    await page.getByLabel("Week containing").fill("2024-02-05");
    await page.getByLabel("Weeks to show").selectOption("4");
    const comparison = page.getByRole("region", { name: "Calendar workload ratio (ACWR)" });
    await expect(comparison).toContainText("1.80×");
    await expect(comparison).toContainText("180 AU");
    await expect(comparison).toContainText("100 AU");
    await expect(comparison).toContainText("2024-01-08");
    await comparison.getByLabel("Comparison week").selectOption("2024-01-29");
    await expect(comparison).toContainText("At least one of the five weeks has no logged sessions.");
    await expect(comparison).not.toContainText("1.80×");
  } finally {
    for (const url of cleanup) {
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});

test("training load downloads a CSV for only the visible weeks", async ({ page, request }) => {
  const tag = `[TEST_RUN_ID:${process.env.TEST_RUN_ID || "local"}:${randomUUID()}]`;
  const ids = [];
  try {
    for (const day of ["2026-09-21", "2026-10-20"]) {
      const log = await request.post("/api/v1/logs", {
        data: {
          performed_at: `${day}T12:00:00Z`,
          total_time_minutes: 40,
          overall_feeling: 3,
          effort_rpe: 7,
          notes: tag,
          exercises: [{ exercise_name: `${tag} Press`, sets_count: 1, weight_kg: 60, reps_per_set: [8], rpe_per_set: [9] }],
        },
      });
      expect(log.status()).toBe(201);
      ids.push((await log.json()).id);
    }
    await page.goto("/training-load");
    await page.getByLabel("Week containing").fill("2026-10-25");
    await page.getByLabel("Weeks to show").selectOption("4");
    const button = page.getByRole("button", { name: "Download training CSV" });
    await expect(button).toBeVisible();
    const waiting = page.waitForEvent("download");
    await button.click();
    const download = await waiting;
    expect(download.suggestedFilename()).toBe("training-load-2026-09-28-through-2026-10-25.csv");
    const content = await readFile(await download.path(), "utf8");
    expect(content).toContain("record_type");
    expect(content).toContain(ids[1]);
    expect(content).toContain(`${tag} Press`);
    expect(content).toContain('"weekly_summary"');
    expect(content).toContain('"weekly_activity_summary"');
    expect(content).not.toContain(ids[0]);
    expect(content.split("\r\n")[0]).toMatch(/,"workload_ratio_status"$/);
    expect(content.split("\r\n").find((line) => line.startsWith('"set",'))).toContain(',"9",');
  } finally {
    for (const id of ids) {
      const url = `/api/v1/logs/${id}`;
      expect((await request.delete(url)).status()).toBe(204);
      expect((await request.get(url)).status()).toBe(404);
    }
  }
});
