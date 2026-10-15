import { describe, expect, it } from "vitest";

import { ACTIVITY_TYPES, activityLabel, logSummaryFacts, logTitle } from "./activity";

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
      "Cycling",
      "Hiking",
      "Running",
      "Other activity",
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
    expect(logTitle(base)).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });
});

describe("logSummaryFacts", () => {
  it("lists duration, distance, effort and training load for an activity", () => {
    expect(
      logSummaryFacts({ ...base, activity_type: "swimming", distance_km: 1.5, effort_rpe: 6 }),
    ).toEqual(["75 min", "1.5 km", "Effort 6/10", "Load 450", "Feeling 4/5"]);
  });

  it("keeps a strength workout to duration and feeling", () => {
    expect(logSummaryFacts(base)).toEqual(["75 min", "Feeling 4/5"]);
  });
});
