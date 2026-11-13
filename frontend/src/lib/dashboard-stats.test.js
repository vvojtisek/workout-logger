import { describe, expect, it } from "vitest";

import { liftNames, muscleSplit, weeklyVolume } from "./dashboard-stats";

// Local noon on Fri 13 Nov 2026 (a Friday); weeks start on Monday.
const NOW = new Date(2026, 10, 13, 12);

/** @param {Date} when @param {{ name: string, reps: number[], kg: number | null }[]} lifts */
function log(when, lifts) {
  return {
    performed_at: when.toISOString(),
    exercises: lifts.map(({ name, reps, kg }) => ({
      id: name,
      exercise_name: name,
      sets_count: reps.length,
      reps_per_set: reps,
      weight_kg: kg,
      rest_time_seconds: 60,
      notes: null,
    })),
  };
}

describe("weeklyVolume", () => {
  it("returns the requested number of weeks, oldest first, with empty weeks as zero", () => {
    const weeks = weeklyVolume([], { weeks: 4, now: NOW });
    expect(weeks.map((week) => week.weekStart)).toEqual([
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
    ]);
    expect(weeks.every((week) => week.sets === 0 && week.volumeKg === 0)).toBe(true);
  });

  it("buckets sets and tonnage into the Monday-based week they happened in", () => {
    const logs = [
      log(new Date(2026, 10, 9, 8), [{ name: "Bench", reps: [5, 5], kg: 100 }]), // Mon this week
      log(new Date(2026, 10, 12, 18), [{ name: "Bench", reps: [5], kg: 100 }]), // Thu this week
      log(new Date(2026, 10, 8, 18), [{ name: "Bench", reps: [10], kg: 50 }]), // Sun, last week
    ];
    const weeks = weeklyVolume(logs, { weeks: 2, now: NOW });
    expect(weeks).toEqual([
      { weekStart: "2026-11-02", sets: 1, volumeKg: 500 },
      { weekStart: "2026-11-09", sets: 3, volumeKg: 1500 },
    ]);
  });

  it("can follow a single lift, matching its name case-insensitively", () => {
    const logs = [
      log(new Date(2026, 10, 10), [
        { name: "Bench", reps: [5], kg: 100 },
        { name: "Row", reps: [8, 8], kg: 60 },
      ]),
    ];
    const weeks = weeklyVolume(logs, { weeks: 1, now: NOW, lift: "row" });
    expect(weeks).toEqual([{ weekStart: "2026-11-09", sets: 2, volumeKg: 960 }]);
  });

  it("ignores logs older than the window", () => {
    const logs = [log(new Date(2026, 5, 1), [{ name: "Bench", reps: [5], kg: 100 }])];
    expect(weeklyVolume(logs, { weeks: 4, now: NOW }).every((week) => week.sets === 0)).toBe(true);
  });
});

describe("liftNames", () => {
  it("lists each lift once, alphabetical", () => {
    const logs = [
      log(new Date(2026, 10, 10), [{ name: "Row", reps: [5], kg: 1 }, { name: "Bench", reps: [5], kg: 1 }]),
      log(new Date(2026, 10, 11), [{ name: "Bench", reps: [5], kg: 1 }]),
    ];
    expect(liftNames(logs)).toEqual(["Bench", "Row"]);
  });
});

describe("muscleSplit", () => {
  /** @type {Pick<import("@/api/types").CatalogExercise, "name" | "aliases" | "primary_muscles" | "secondary_muscles">[]} */
  const catalogue = [
    { name: "Bench", aliases: ["Barbell Bench Press"], primary_muscles: ["chest"], secondary_muscles: ["triceps", "shoulders"] },
    { name: "Row", aliases: [], primary_muscles: ["back"], secondary_muscles: ["biceps"] },
  ];

  it("counts a set fully for its primary muscles and half for secondary ones", () => {
    const logs = [log(new Date(2026, 10, 12), [{ name: "Bench", reps: [5, 5, 5, 5], kg: 100 }])];
    const split = muscleSplit(logs, catalogue, { days: 7, now: NOW });
    const sets = Object.fromEntries(split.rows.map((row) => [row.muscle, row.sets]));
    expect(sets.chest).toBe(4);
    expect(sets.triceps).toBe(2);
    expect(sets.shoulders).toBe(2);
    expect(sets.back).toBe(0);
  });

  it("matches an exercise by alias, case-insensitively", () => {
    const logs = [log(new Date(2026, 10, 12), [{ name: "barbell bench press", reps: [5], kg: 100 }])];
    const split = muscleSplit(logs, catalogue, { days: 7, now: NOW });
    expect(split.rows.find((row) => row.muscle === "chest")?.sets).toBe(1);
    expect(split.unmatchedSets).toBe(0);
  });

  it("reports sets it could not classify rather than dropping them silently", () => {
    const logs = [log(new Date(2026, 10, 12), [{ name: "Mystery Machine", reps: [10, 10], kg: 20 }])];
    expect(muscleSplit(logs, catalogue, { days: 7, now: NOW }).unmatchedSets).toBe(2);
  });

  it("respects the window and marks muscles with nothing in it as under-trained", () => {
    const logs = [
      log(new Date(2026, 10, 12), [{ name: "Bench", reps: [5], kg: 100 }]),
      log(new Date(2026, 9, 20), [{ name: "Row", reps: [8, 8], kg: 60 }]), // 24 days ago
    ];
    const week = muscleSplit(logs, catalogue, { days: 7, now: NOW });
    expect(week.rows.find((row) => row.muscle === "back")).toMatchObject({ sets: 0, under: true });
    const month = muscleSplit(logs, catalogue, { days: 28, now: NOW });
    expect(month.rows.find((row) => row.muscle === "back")).toMatchObject({ sets: 2, under: false });
  });

  it("sorts busiest muscle first and leaves full_body out unless it was trained", () => {
    const logs = [log(new Date(2026, 10, 12), [{ name: "Row", reps: [8, 8, 8], kg: 60 }])];
    const split = muscleSplit(logs, catalogue, { days: 7, now: NOW });
    expect(split.rows[0].muscle).toBe("back");
    expect(split.rows.some((row) => row.muscle === "full_body")).toBe(false);
  });
});
