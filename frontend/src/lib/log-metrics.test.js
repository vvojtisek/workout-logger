import { describe, expect, it } from "vitest";

import { filterLogs, formatTonnage, logMetrics, planNames } from "./log-metrics";

/** @param {string} name @param {number[]} reps @param {number | null} weight */
const lift = (name, reps, weight) => ({
  id: name,
  exercise_name: name,
  sets_count: reps.length,
  reps_per_set: reps,
  weight_kg: weight,
  rest_time_seconds: 90,
  notes: null,
});

describe("logMetrics", () => {
  it("adds up sets and volume (reps x load) across exercises", () => {
    const metrics = logMetrics({
      exercises: [lift("Bench", [5, 5, 4], 100), lift("Row", [10, 10], 60)],
    });
    expect(metrics.sets).toBe(5);
    expect(metrics.volumeKg).toBe(14 * 100 + 20 * 60);
  });

  it("names the heaviest set with its best reps", () => {
    const metrics = logMetrics({
      exercises: [lift("Row", [10], 60), lift("Bench", [5, 6], 100)],
    });
    expect(metrics.best).toEqual({ name: "Bench", weightKg: 100, reps: 6 });
  });

  it("counts unloaded exercises as sets but not as volume or a best set", () => {
    const metrics = logMetrics({ exercises: [lift("Push-up", [20, 15], null)] });
    expect(metrics).toEqual({ sets: 2, volumeKg: 0, best: null });
  });

  it("is empty for a log without exercises, such as an activity", () => {
    expect(logMetrics({ exercises: [] })).toEqual({ sets: 0, volumeKg: 0, best: null });
    expect(logMetrics({})).toEqual({ sets: 0, volumeKg: 0, best: null });
  });
});

describe("formatTonnage", () => {
  it("groups thousands and drops fractions", () => {
    expect(formatTonnage(6420)).toBe("6,420 kg");
    expect(formatTonnage(512.4)).toBe("512 kg");
    expect(formatTonnage(0)).toBe("0 kg");
  });
});

describe("filterLogs", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const logs = [
    { id: "a", performed_at: "2026-11-12T10:00:00Z", source_plan_name: "Push" },
    { id: "b", performed_at: "2026-10-30T10:00:00Z", source_plan_name: "Pull" },
    { id: "c", performed_at: "2026-08-01T10:00:00Z", source_plan_name: "Push" },
    { id: "d", performed_at: "2026-11-01T10:00:00Z", source_plan_name: null },
  ];
  const ids = (/** @type {{ id: string }[]} */ items) => items.map((item) => item.id);

  it("keeps everything when no filter is set", () => {
    expect(ids(filterLogs(logs, { days: null, plan: "" }, now))).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps only the last N days", () => {
    expect(ids(filterLogs(logs, { days: 30, plan: "" }, now))).toEqual(["a", "b", "d"]);
    expect(ids(filterLogs(logs, { days: 7, plan: "" }, now))).toEqual(["a"]);
  });

  it("filters by plan name and combines with the range", () => {
    expect(ids(filterLogs(logs, { days: null, plan: "Push" }, now))).toEqual(["a", "c"]);
    expect(ids(filterLogs(logs, { days: 30, plan: "Push" }, now))).toEqual(["a"]);
  });
});

describe("planNames", () => {
  it("lists each plan once, sorted, ignoring logs without one", () => {
    expect(
      planNames([{ source_plan_name: "Push" }, { source_plan_name: null }, { source_plan_name: "Pull" }, { source_plan_name: "Push" }]),
    ).toEqual(["Pull", "Push"]);
  });
});
