import { describe, expect, it } from "vitest";

import { ACTIVITY_TYPES, activityLabel, isRecoveryType, logSummaryFacts, logTitle } from "./activity";

const base = {
  performed_at: "2026-10-14T19:30:00Z",
  total_time_minutes: 75,
  overall_feeling: 4,
  source_plan_name: null,
  activity_type: null,
  distance_km: null,
  effort_rpe: null,
};

describe("activityLabel", () => {
  it("names every supported activity", () => {
    expect(ACTIVITY_TYPES.map(activityLabel)).toEqual([
      "Ice hockey",
      "Swimming",
      "Sauna",
      "Cycling",
      "Hiking",
      "Running",
      "Other activity",
      "Meditation",
      "Stretching",
      "Cold plunge",
      "Hot tub (Jacuzzi)",
      "Massage",
    ]);
  });
});

describe("logTitle", () => {
  it("prefers the activity, then the plan", () => {
    expect(logTitle({ ...base, activity_type: "ice_hockey", source_plan_name: "A" })).toBe(
      "Ice hockey",
    );
    expect(logTitle({ ...base, source_plan_name: "Office A/B" })).toBe("Office A/B");
  });

  it("falls back to the date", () => {
    expect(logTitle(base)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("logSummaryFacts", () => {
  it("lists duration, distance, effort and training load for an activity", () => {
    expect(
      logSummaryFacts({ ...base, activity_type: "swimming", distance_km: 1.5, effort_rpe: 6 }),
    ).toEqual(["75 min", "1.5 km", "Effort 6/10 (Hard to very hard)", "Load 450", "Feeling 4/5 (Good)"]);
  });

  it("keeps a strength workout to duration and feeling", () => {
    expect(logSummaryFacts(base)).toEqual(["75 min", "Feeling 4/5 (Good)"]);
  });

  it("adds the volume of a strength workout when it has one", () => {
    expect(logSummaryFacts({ ...base, total_volume_kg: 2480 })).toEqual([
      "75 min",
      "Feeling 4/5 (Good)",
      "Volume 2 480 kg",
    ]);
  });
});

describe("cardio and recovery summaries", () => {
  it("shows cycles, the 1-5 effort and load, and a custom name", () => {
    const sauna = { ...base, activity_type: /** @type {const} */ ("sauna"), total_time_minutes: 45, cycles: 3, cycle_minutes: 12, sauna_rounds: 3 };
    expect(logSummaryFacts(sauna)).toEqual(["45 min", "3 cycles × 12 min", "Feeling 4/5 (Good)"]);
    const hockey = { ...base, activity_type: /** @type {const} */ ("ice_hockey"), total_time_minutes: 60, effort_level: 4, effort_rpe: 7 };
    expect(logSummaryFacts(hockey)).toEqual(["60 min", "Effort 4/5 (Hard)", "Load 420", "Feeling 4/5 (Good)"]);
    expect(logTitle({ ...base, activity_type: /** @type {const} */ ("other"), activity_name: "Paddleboarding" })).toBe("Paddleboarding");
    expect(isRecoveryType("cold_plunge")).toBe(true);
    expect(isRecoveryType("swimming")).toBe(false);
  });
});
