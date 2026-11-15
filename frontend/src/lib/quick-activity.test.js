import { describe, expect, it } from "vitest";

import { CARDIO_TYPES, RECOVERY_TYPES } from "./activity";
import {
  applyPrefill,
  dayChoices,
  defaultsPath,
  durationChoices,
  localDateTimeToIso,
  newQuickForm,
  nowSlot,
  presetBody,
  quickActivityBody,
  rankedTypes,
  timeChoices,
} from "./quick-activity";

/**
 * @param {Partial<import("./quick-activity").TypeDefaults>} overrides
 * @returns {import("./quick-activity").TypeDefaults}
 */
function typeDefaults(overrides) {
  return {
    activity_type: "swimming",
    activity_name: null,
    start_time: "18:00",
    started_at: null,
    duration_minutes: 30,
    effort_level: 2,
    cycles: null,
    cycle_minutes: null,
    observations: 8,
    same_weekday_observations: 4,
    basis: "same_weekday",
    ...overrides,
  };
}

/** @type {import("./quick-activity").ActivityDefaults} */
const DEFAULTS = {
  date: "2026-12-15",
  day_of_week: 1,
  season: "winter",
  category: "cardio",
  timezone: "Europe/Prague",
  weeks: 8,
  history_entries: 12,
  suggested: typeDefaults({}),
  ranked: [
    typeDefaults({}),
    typeDefaults({ activity_type: "ice_hockey", start_time: "19:30", duration_minutes: 75, effort_level: 4 }),
    typeDefaults({ activity_type: "cycling", start_time: null, duration_minutes: 60, effort_level: 3, basis: "default" }),
  ],
  time_slots: ["18:00", "07:00"],
  presets: [],
  link_candidates: [],
};

describe("quick activity prefill", () => {
  const now = new Date(2026, 11, 15, 12, 7);

  it("fills an untouched form with the suggested activity", () => {
    const form = applyPrefill(newQuickForm("ice_hockey", now), DEFAULTS, new Set(), CARDIO_TYPES, "12:00");
    expect(form).toMatchObject({ type: "swimming", time: "18:00", duration: 30, effort: 2 });
  });

  it("keeps what the person chose and fills the rest from their activity", () => {
    const start = { ...newQuickForm("ice_hockey", now), duration: 45 };
    const form = applyPrefill(start, DEFAULTS, new Set(["type", "duration"]), CARDIO_TYPES, "12:00");
    expect(form).toMatchObject({ type: "ice_hockey", time: "19:30", duration: 45, effort: 4 });
  });

  it("uses the current slot when the activity has no usual start", () => {
    const form = applyPrefill(newQuickForm("cycling", now), DEFAULTS, new Set(["type"]), CARDIO_TYPES, "12:00");
    expect(form).toMatchObject({ type: "cycling", time: "12:00", duration: 60, effort: 3 });
  });

  it("ignores a suggestion outside the form's category", () => {
    const form = applyPrefill(newQuickForm("sauna", now), DEFAULTS, new Set(), RECOVERY_TYPES, "12:00");
    expect(form.type).toBe("sauna");
  });

  it("orders chips by the ranking, then the rest", () => {
    expect(rankedTypes(DEFAULTS, CARDIO_TYPES)).toEqual([
      "swimming",
      "ice_hockey",
      "cycling",
      "hiking",
      "running",
      "other",
    ]);
    expect(rankedTypes(undefined, RECOVERY_TYPES)).toEqual([...RECOVERY_TYPES]);
  });

  it("offers the predicted start first, then the weekday's usual ones, then now", () => {
    expect(timeChoices(DEFAULTS, "18:00", "12:00")).toEqual(["18:00", "07:00", "12:00"]);
    expect(timeChoices(undefined, null, "12:00")).toEqual(["12:00"]);
  });

  it("adds an unusual predicted duration to the pills", () => {
    expect(durationChoices([30, 45, 60, 90], 75)).toEqual([30, 45, 60, 75, 90]);
    expect(durationChoices([30, 45, 60, 90], 45)).toEqual([30, 45, 60, 90]);
  });
});

describe("quick activity dates and bodies", () => {
  it("rounds now to the nearest 15 minutes", () => {
    expect(nowSlot(new Date(2026, 0, 1, 18, 7))).toBe("18:00");
    expect(nowSlot(new Date(2026, 0, 1, 18, 8))).toBe("18:15");
    expect(nowSlot(new Date(2026, 0, 1, 23, 53))).toBe("00:00");
  });

  it("offers today and yesterday as local days", () => {
    expect(dayChoices(new Date(2026, 2, 1, 9, 0))).toEqual([
      { label: "Today", value: "2026-03-01" },
      { label: "Yesterday", value: "2026-02-28" },
    ]);
  });

  it("turns a local day and time into UTC and rejects nonsense", () => {
    expect(localDateTimeToIso("2026-11-14", "19:30")).toBe(new Date(2026, 10, 14, 19, 30).toISOString());
    expect(localDateTimeToIso("2026-02-30", "19:30")).toBeNull();
    expect(localDateTimeToIso("2026-11-14", "25:00")).toBeNull();
    expect(localDateTimeToIso("", "19:30")).toBeNull();
  });

  it("builds the /coach/log activity and requires effort for cardio", () => {
    const form = {
      ...newQuickForm("ice_hockey", new Date(2026, 10, 15, 12, 0)),
      day: "2026-11-14",
      time: "19:30",
      duration: 75,
      effort: null,
      feelAfter: 2,
    };
    expect(quickActivityBody(form, { requireEffort: true })).toEqual({
      body: null,
      error: "Pick how hard it was (1-5).",
    });
    expect(quickActivityBody({ ...form, effort: 4 }, { requireEffort: true }).body).toEqual({
      type: "ice_hockey",
      performed_at: new Date(2026, 10, 14, 19, 30).toISOString(),
      duration_minutes: 75,
      effort_level: 4,
      feel_after: 2,
    });
  });

  it("names a custom activity and controls the recovery link", () => {
    const base = { ...newQuickForm("other", new Date(2026, 10, 15, 12, 0)), effort: 3, name: "  Paddleboarding " };
    expect(quickActivityBody(base, { requireEffort: true }).body).toMatchObject({
      activity_name: "Paddleboarding",
    });
    const sauna = { ...newQuickForm("sauna", new Date(2026, 10, 15, 12, 0)), cycles: 3, cycleMinutes: 12 };
    expect(quickActivityBody({ ...sauna, linkedLogId: null }, { requireEffort: false }).body).toMatchObject({
      cycles: 3,
      cycle_minutes: 12,
      link_to_previous: false,
    });
    expect(quickActivityBody({ ...sauna, linkedLogId: "abc" }, { requireEffort: false }).body).toMatchObject({
      linked_log_id: "abc",
    });
    expect(quickActivityBody({ ...sauna, duration: 0 }, { requireEffort: false }).error).toBe(
      "Duration must be 1 to 600 minutes.",
    );
  });

  it("logs a one-tap preset now", () => {
    const now = new Date(2026, 10, 15, 18, 40);
    expect(
      presetBody(
        { label: "Sauna · 3 cycles", activity_type: "sauna", duration_minutes: 45, cycles: 3, cycle_minutes: null, times_logged: 5 },
        now,
      ),
    ).toEqual({ type: "sauna", performed_at: now.toISOString(), duration_minutes: 45, cycles: 3 });
  });

  it("asks the defaults endpoint for the category, day and zone", () => {
    expect(defaultsPath("recovery", "2026-11-14", "Europe/Prague")).toBe(
      "/activities/defaults?category=recovery&date=2026-11-14&timezone=Europe%2FPrague",
    );
  });
});
