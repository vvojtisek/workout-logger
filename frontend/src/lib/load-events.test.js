import { describe, expect, it } from "vitest";

import {
  clockTime,
  loadWarningMessage,
  defaultSeason,
  describeLoadEvent,
  draftFromLoadEvent,
  draftIsDirty,
  draftToPayload,
  emptyDraft,
  occurrencesByDate,
} from "./load-events";

/** @returns {import("@/api/types").LoadEvent} */
function savedEvent() {
  return {
    id: "e1",
    name: "League game",
    kind: "game",
    weekday: 5,
    start_time: "19:30:00",
    duration_minutes: 75,
    season_start: "2026-09-01",
    season_end: "2027-03-31",
    created_at: "2026-10-16T08:00:00Z",
    updated_at: "2026-10-16T08:00:00Z",
  };
}

describe("load events", () => {
  it("shows the start as a 24-hour clock time", () => {
    expect(clockTime("19:30:00")).toBe("19:30");
    expect(clockTime("06:05")).toBe("06:05");
  });

  it("describes when an event happens", () => {
    expect(describeLoadEvent(savedEvent())).toBe("Sat 19:30, 75 min");
  });

  it("defaults to the hockey season that is running or next", () => {
    expect(defaultSeason(new Date(2026, 9, 16))).toEqual({
      start: "2026-09-01",
      end: "2027-03-31",
    });
    expect(defaultSeason(new Date(2027, 1, 10))).toEqual({
      start: "2026-09-01",
      end: "2027-03-31",
    });
    expect(defaultSeason(new Date(2027, 5, 1))).toEqual({
      start: "2027-09-01",
      end: "2028-03-31",
    });
  });

  it("builds a payload the API accepts", () => {
    const draft = { ...emptyDraft(new Date(2026, 9, 16)), name: " Practice ", startTime: "20:15" };
    expect(draftToPayload(draft)).toEqual({
      ok: true,
      payload: {
        name: "Practice",
        kind: "practice",
        weekday: 1,
        start_time: "20:15",
        duration_minutes: 60,
        season_start: "2026-09-01",
        season_end: "2027-03-31",
      },
    });
  });

  it("rejects what the API would reject", () => {
    const base = { ...emptyDraft(new Date(2026, 9, 16)), name: "Game", startTime: "19:30" };
    /** @type {Array<[Partial<import("./load-events").LoadEventDraft>, string]>} */
    const cases = [
      [{ name: "  " }, "Name is required."],
      [{ startTime: "" }, "Start time is required."],
      [{ startTime: "7.30" }, "Start time is a 24-hour time such as 19:30."],
      [{ startTime: "24:00" }, "Start time is a 24-hour time such as 19:30."],
      [{ minutes: "10" }, "Duration is a whole number from 15 to 300 minutes."],
      [{ minutes: "1.5" }, "Duration is a whole number from 15 to 300 minutes."],
      [{ seasonEnd: "2026-08-31" }, "The season must end on or after it starts."],
      [{ seasonEnd: "2027-09-03" }, "A season is at most 366 days."],
      [{ seasonStart: "" }, "Season start and end are required."],
    ];
    for (const [override, error] of cases) {
      expect(draftToPayload({ ...base, ...override })).toEqual({ ok: false, error });
    }
  });

  it("pads a one-digit hour", () => {
    const draft = { ...emptyDraft(new Date(2026, 9, 16)), name: "Skate", startTime: " 7:05 " };
    const result = draftToPayload(draft);
    expect(result.ok && result.payload.start_time).toBe("07:05");
  });

  it("knows when a saved event has unsaved edits", () => {
    const saved = savedEvent();
    const draft = draftFromLoadEvent(saved);
    expect(draft.startTime).toBe("19:30");
    expect(draftIsDirty(draft, saved)).toBe(false);
    expect(draftIsDirty({ ...draft, weekday: 2 }, saved)).toBe(true);
  });

  it("groups calendar occurrences by date", () => {
    const occurrence = {
      event_id: "e1",
      date: "2026-10-03",
      start_time: "19:30:00",
      duration_minutes: 75,
      kind: /** @type {const} */ ("game"),
      name: "League game",
    };
    const grouped = occurrencesByDate([
      occurrence,
      { ...occurrence, start_time: "07:00:00", name: "Early skate" },
      { ...occurrence, date: "2026-10-10" },
    ]);
    expect(grouped.get("2026-10-03")?.map((item) => item.name)).toEqual([
      "League game",
      "Early skate",
    ]);
    expect(grouped.get("2026-10-10")).toHaveLength(1);
    expect(grouped.get("2026-10-04")).toBeUndefined();
  });

  it("explains a heavy-legs warning in plain words", () => {
    const game = {
      event_id: "e1",
      date: "2026-10-17",
      start_time: "19:30:00",
      duration_minutes: 75,
      kind: /** @type {const} */ ("game"),
      name: "League game",
    };
    /** @param {Partial<import("@/api/types").LoadWarning>} override */
    const warning = (override) => ({
      scheduled_workout_id: "w1",
      heavy_exercises: ["Back squat", "Romanian deadlift"],
      events: [game],
      move_to: null,
      swap_plans: [],
      ...override,
    });
    expect(loadWarningMessage(warning({}), "2026-10-16")).toBe(
      "Heavy leg work (Back squat, Romanian deadlift) the day before League game at 19:30.",
    );
    expect(loadWarningMessage(warning({}), "2026-10-17")).toBe(
      "Heavy leg work (Back squat, Romanian deadlift) on the day of League game at 19:30.",
    );
  });
});
