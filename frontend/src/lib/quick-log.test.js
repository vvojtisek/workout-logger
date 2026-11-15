import { describe, expect, it } from "vitest";

import {
  HOCKEY_DEFAULT_MINUTES,
  activityBody,
  checkInBody,
  hockeyMinutes,
  isPendingLog,
  logsOn,
  optimisticLog,
} from "./quick-log";

/**
 * @param {string} date
 * @param {number} duration_minutes
 * @returns {import("@/api/types").LoadEventOccurrence}
 */
const occurrence = (date, duration_minutes) => ({
  event_id: "e1",
  date,
  start_time: "19:30",
  duration_minutes,
  kind: "game",
  name: "League",
});

describe("hockeyMinutes", () => {
  it("uses today's scheduled duration, else the default", () => {
    expect(hockeyMinutes([occurrence("2026-11-15", 90)], "2026-11-15")).toBe(90);
    expect(hockeyMinutes([occurrence("2026-11-16", 60)], "2026-11-15")).toBe(HOCKEY_DEFAULT_MINUTES);
    expect(
      hockeyMinutes([occurrence("2026-11-15", 60), occurrence("2026-11-15", 80)], "2026-11-15"),
    ).toBe(80);
  });
});

describe("activityBody", () => {
  it("leaves swim + sauna defaults to the server and sends hockey minutes", () => {
    expect(activityBody("swim_sauna")).toEqual({ activity: { type: "swim_sauna" } });
    expect(activityBody("ice_hockey", 60)).toEqual({
      activity: { type: "ice_hockey", duration_minutes: 60 },
    });
  });
});

describe("checkInBody", () => {
  it("saves energy as fatigue and the local date", () => {
    const body = checkInBody(6, 8, ["quads"], new Date(2026, 10, 15, 7, 0));
    expect(body.readiness).toEqual({
      log_date: "2026-11-15",
      soreness: 6,
      fatigue: 3,
      sore_muscle_groups: ["quads"],
    });
  });
  it("drops muscle tags when nothing is sore", () => {
    expect(checkInBody(1, 5, ["quads"], new Date()).readiness?.sore_muscle_groups).toEqual([]);
  });
});

describe("optimisticLog", () => {
  it("mirrors the server defaults", () => {
    const swim = optimisticLog("swim_sauna", new Date("2026-11-15T07:00:00Z"));
    expect(swim).toMatchObject({ activity_type: "swimming", total_time_minutes: 30, laps: 30, sauna_rounds: 3 });
    expect(isPendingLog(swim)).toBe(true);
    expect(optimisticLog("ice_hockey", new Date(), 90).total_time_minutes).toBe(90);
  });
});

describe("logsOn", () => {
  it("keeps the local day, newest first", () => {
    /** @param {number} h */
    const at = (h) => new Date(2026, 10, 15, h).toISOString();
    const logs = [{ performed_at: at(8) }, { performed_at: new Date(2026, 10, 14, 20).toISOString() }, { performed_at: at(18) }];
    expect(logsOn(logs, "2026-11-15").map((log) => log.performed_at)).toEqual([at(18), at(8)]);
  });
});
