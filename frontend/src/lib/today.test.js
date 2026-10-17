import { describe, expect, it } from "vitest";

import {
  dayHeading,
  formatSleepDuration,
  hockeyToConfirm,
  hockeyLogPayload,
  isoWeek,
  localIsoDate,
  mealTypeAt,
  nextSportEvent,
  readSkippedEvents,
  repeatMealPayload,
  repeatableMeals,
  shiftMinutes,
  sleepDefaults,
  sleepPayload,
  sleepWindow,
  writeSkippedEvent,
} from "./today";

/** @returns {import("@/api/types").MealItem} */
function item(overrides = {}) {
  return {
    id: "i1",
    food_id: "oats",
    food_name_snapshot: "Ovesné vločky",
    quantity: 60,
    unit: "g",
    energy_kcal_snapshot: 223.2,
    protein_g_snapshot: 7.8,
    carbohydrate_g_snapshot: 36,
    fat_g_snapshot: 4,
    fiber_g_snapshot: 6,
    ...overrides,
  };
}

/**
 * @param {string} id @param {string} consumedAt
 * @param {import("@/api/types").MealItem[]} items
 * @returns {import("@/api/types").MealEntry}
 */
function meal(id, consumedAt, items) {
  return {
    id,
    consumed_at: consumedAt,
    meal_type: "breakfast",
    notes: null,
    items,
    created_at: consumedAt,
    updated_at: consumedAt,
  };
}

/**
 * @param {Date} start @param {Date} end @param {string} sleepDate
 * @returns {import("@/api/types").SleepEntry}
 */
function sleep(start, end, sleepDate) {
  return {
    id: "s1",
    sleep_start: start.toISOString(),
    sleep_end: end.toISOString(),
    timezone: "Europe/Prague",
    sleep_date: sleepDate,
    time_in_bed_seconds: (end.getTime() - start.getTime()) / 1000,
    estimated_sleep_seconds: null,
    awake_seconds: null,
    quality_score: 4,
    resting_heart_rate: null,
    notes: null,
    source: "manual",
    created_at: end.toISOString(),
    updated_at: end.toISOString(),
  };
}

/**
 * @param {string} date @param {string} [start]
 * @returns {import("@/api/types").LoadEventOccurrence}
 */
function practice(date, start = "19:00:00") {
  return {
    event_id: "hockey",
    date,
    start_time: start,
    duration_minutes: 60,
    kind: "practice",
    name: "Tuesday practice",
  };
}

describe("today's heading", () => {
  it("names the weekday and writes the date as dd/MM/yyyy", () => {
    expect(dayHeading(new Date(2026, 9, 17, 8, 0))).toBe("Sat 17/10/2026");
    expect(dayHeading(new Date(2026, 0, 5))).toBe("Mon 05/01/2026");
  });

  it("numbers weeks from Monday, ISO style", () => {
    expect(isoWeek(new Date(2026, 9, 17))).toBe(42);
    expect(isoWeek(new Date(2026, 9, 12))).toBe(42);
    expect(isoWeek(new Date(2026, 9, 11))).toBe(41);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
  });

  it("gives the local calendar date in ISO form for API queries", () => {
    expect(localIsoDate(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07");
  });
});

describe("meal type from the clock", () => {
  it.each([
    [7, 10, "breakfast"],
    [10, 59, "breakfast"],
    [11, 0, "lunch"],
    [15, 30, "snack"],
    [18, 0, "dinner"],
    [22, 30, "snack"],
    [2, 0, "snack"],
  ])("%i:%i is %s", (hour, minute, expected) => {
    expect(mealTypeAt(new Date(2026, 9, 17, hour, minute))).toBe(expected);
  });
});

describe("repeatable meals", () => {
  const breakfast = [
    item(),
    item({ id: "i2", food_id: "milk", food_name_snapshot: "Mléko", quantity: 200, energy_kcal_snapshot: 92, protein_g_snapshot: 6.8 }),
  ];
  const entries = [
    meal("m3", "2026-10-17T06:00:00Z", [item({ id: "x", food_id: "egg", food_name_snapshot: "Vejce", quantity: 150, energy_kcal_snapshot: 215, protein_g_snapshot: 19 })]),
    meal("m2", "2026-10-16T06:00:00Z", breakfast),
    meal("m1", "2026-10-15T06:00:00Z", breakfast.map((i) => ({ ...i, id: `${i.id}-old` }))),
  ];

  it("ranks meals eaten more often first and merges identical ones", () => {
    const options = repeatableMeals(entries);
    expect(options.map((option) => option.label)).toEqual(["Ovesné vločky, Mléko", "Vejce"]);
    expect(options[0].times).toBe(2);
    expect(options[0].entry.id).toBe("m2");
    expect(options[0].energyKcal).toBe(315);
    expect(options[0].proteinG).toBe(14.6);
  });

  it("caps the list", () => {
    expect(repeatableMeals(entries, 1)).toHaveLength(1);
  });

  it("re-logs food-backed items by food and amount, and ad hoc items with their nutrition", () => {
    const adHoc = item({ id: "a", food_id: null, food_name_snapshot: "Bageta", quantity: 1, unit: "ks", energy_kcal_snapshot: 450, fiber_g_snapshot: null });
    const now = new Date(2026, 9, 17, 12, 40);
    const payload = repeatMealPayload(meal("m", "2026-10-16T06:00:00Z", [item(), adHoc]), now);
    expect(payload.consumed_at).toBe(now.toISOString());
    expect(payload.meal_type).toBe("lunch");
    expect(payload.items).toEqual([
      { food_id: "oats", quantity: 60 },
      {
        food_id: null,
        quantity: 1,
        unit: "ks",
        food_name_snapshot: "Bageta",
        energy_kcal: 450,
        protein_g: 7.8,
        carbohydrate_g: 36,
        fat_g: 4,
        fiber_g: null,
      },
    ]);
  });
});

describe("sleep card", () => {
  it("defaults to the times of the last night logged", () => {
    const last = sleep(new Date(2026, 9, 15, 23, 40), new Date(2026, 9, 16, 6, 35), "2026-10-16");
    expect(sleepDefaults(last)).toEqual({ bedMinutes: 23 * 60 + 40, wakeMinutes: 6 * 60 + 35 });
    expect(sleepDefaults(null)).toEqual({ bedMinutes: 23 * 60, wakeMinutes: 7 * 60 });
  });

  it("steps clock times by a quarter hour across midnight", () => {
    expect(shiftMinutes(23 * 60 + 50, 15)).toBe(5);
    expect(shiftMinutes(5, -15)).toBe(23 * 60 + 50);
  });

  it("puts bedtime on the evening before when it is later than waking", () => {
    const today = new Date(2026, 9, 17, 8, 0);
    const { start, end } = sleepWindow(today, 23 * 60 + 30, 6 * 60 + 30);
    expect(start).toEqual(new Date(2026, 9, 16, 23, 30));
    expect(end).toEqual(new Date(2026, 9, 17, 6, 30));
    const afterMidnight = sleepWindow(today, 30, 7 * 60);
    expect(afterMidnight.start).toEqual(new Date(2026, 9, 17, 0, 30));
  });

  it("builds the sleep entry payload with the device timezone", () => {
    const today = new Date(2026, 9, 17, 8, 0);
    expect(sleepPayload(today, 23 * 60, 7 * 60, 4, "Europe/Prague")).toEqual({
      sleep_start: new Date(2026, 9, 16, 23, 0).toISOString(),
      sleep_end: new Date(2026, 9, 17, 7, 0).toISOString(),
      timezone: "Europe/Prague",
      quality_score: 4,
    });
  });

  it("writes durations in hours and minutes", () => {
    expect(formatSleepDuration(6 * 3600 + 55 * 60)).toBe("6 h 55 min");
    expect(formatSleepDuration(8 * 3600)).toBe("8 h 00 min");
  });
});

describe("hockey confirm", () => {
  const now = new Date(2026, 9, 20, 21, 0);

  it("asks about today's events that have started and are not logged or skipped", () => {
    const occurrences = [practice("2026-10-20"), practice("2026-10-20", "22:00:00"), practice("2026-10-22")];
    expect(hockeyToConfirm(occurrences, [], new Set(), now)).toEqual([occurrences[0]]);
  });

  it("treats an ice hockey log on the same day as done", () => {
    /** @type {{ activity_type: import("./activity").ActivityType | null, performed_at: string }[]} */
    const logs = [{ activity_type: "ice_hockey", performed_at: new Date(2026, 9, 20, 19, 5).toISOString() }];
    expect(hockeyToConfirm([practice("2026-10-20")], logs, new Set(), now)).toEqual([]);
    const gym = [{ activity_type: null, performed_at: new Date(2026, 9, 20, 7, 0).toISOString() }];
    expect(hockeyToConfirm([practice("2026-10-20")], gym, new Set(), now)).toHaveLength(1);
  });

  it("hides an event marked as skipped", () => {
    expect(hockeyToConfirm([practice("2026-10-20")], [], new Set(["hockey:2026-10-20"]), now)).toEqual([]);
  });

  it("logs a confirmed event at its scheduled time and length", () => {
    expect(hockeyLogPayload(practice("2026-10-20"), 4)).toEqual({
      activity_type: "ice_hockey",
      performed_at: new Date(2026, 9, 20, 19, 0).toISOString(),
      total_time_minutes: 60,
      distance_km: null,
      effort_rpe: null,
      overall_feeling: 4,
      notes: "Tuesday practice",
      exercises: [],
    });
  });

  it("remembers skipped events, tolerating blocked storage", () => {
    /** @type {Map<string, string>} */
    const store = new Map();
    const storage = {
      getItem: (/** @type {string} */ key) => store.get(key) ?? null,
      setItem: (/** @type {string} */ key, /** @type {string} */ value) => void store.set(key, value),
      removeItem: (/** @type {string} */ key) => void store.delete(key),
    };
    writeSkippedEvent(storage, "hockey:2026-10-20");
    expect(readSkippedEvents(storage).has("hockey:2026-10-20")).toBe(true);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    expect(readSkippedEvents(blocked).size).toBe(0);
    expect(() => writeSkippedEvent(blocked, "x")).not.toThrow();
  });

  it("names the next sport event relative to today", () => {
    const occurrences = [practice("2026-10-20", "19:00:00"), practice("2026-10-21", "20:00:00"), practice("2026-10-25", "20:00:00")];
    expect(nextSportEvent(occurrences, new Date(2026, 9, 20, 18, 0))).toEqual({ occurrence: occurrences[0], when: "Today 19:00" });
    expect(nextSportEvent(occurrences, now)?.when).toBe("Tomorrow 20:00");
    expect(nextSportEvent(occurrences.slice(2), now)?.when).toBe("Sun 20:00");
    expect(nextSportEvent([], now)).toBeNull();
  });
});
