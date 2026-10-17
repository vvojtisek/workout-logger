import type { LoadEventOccurrence, MealEntry, MealType, SleepEntry } from "@/api/types";
import type { ActivityType } from "./activity";
import { WEEKDAY_LABELS } from "./program-templates";

// The phone's Today screen: what to show and what one tap saves. Dates on
// this screen follow the dd/MM/yyyy convention; API queries stay ISO.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Monday = 0, matching WEEKDAY_LABELS and the API. */
function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** A local date as YYYY-MM-DD, for API queries. */
export function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Sat 17/10/2026". */
export function dayHeading(date: Date): string {
  return `${WEEKDAY_LABELS[weekdayIndex(date)]} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** ISO 8601 week number: weeks start Monday, week 1 holds the first Thursday. */
export function isoWeek(date: Date): number {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const thursday = new Date(day);
  thursday.setUTCDate(day.getUTCDate() + 3 - ((day.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.floor((thursday.getTime() - yearStart.getTime()) / 86_400_000 / 7) + 1;
}

/** The meal a clock time most likely is; the meal form still lets you change it. */
export function mealTypeAt(date: Date): MealType {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < 4 * 60) return "snack";
  if (minutes < 11 * 60) return "breakfast";
  if (minutes < 15 * 60) return "lunch";
  if (minutes < 17 * 60) return "snack";
  if (minutes < 22 * 60) return "dinner";
  return "snack";
}

export interface RepeatableMeal {
  key: string;
  label: string;
  times: number;
  energyKcal: number;
  proteinG: number;
  /** The most recent entry with these items; re-logging copies it. */
  entry: MealEntry;
}

function mealSignature(entry: MealEntry): string {
  return entry.items
    .map((item) => `${item.food_id ?? `adhoc:${item.food_name_snapshot}`}@${item.quantity}`)
    .sort()
    .join("|");
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Meals you have logged before, most often eaten first, then most recent. */
export function repeatableMeals(entries: MealEntry[], limit = 4): RepeatableMeal[] {
  const byKey = new Map<string, RepeatableMeal>();
  const newestFirst = [...entries].sort((a, b) => b.consumed_at.localeCompare(a.consumed_at));
  for (const entry of newestFirst) {
    if (entry.items.length === 0) continue;
    const key = mealSignature(entry);
    const known = byKey.get(key);
    if (known) {
      known.times += 1;
      continue;
    }
    byKey.set(key, {
      key,
      label: entry.items.map((item) => item.food_name_snapshot).join(", "),
      times: 1,
      energyKcal: Math.round(entry.items.reduce((sum, item) => sum + item.energy_kcal_snapshot, 0)),
      proteinG: round1(entry.items.reduce((sum, item) => sum + item.protein_g_snapshot, 0)),
      entry,
    });
  }
  // Map keeps insertion (newest-first) order, so a stable sort on count keeps
  // recency as the tie-break.
  return [...byKey.values()].sort((a, b) => b.times - a.times).slice(0, limit);
}

/** The same items again, eaten now. */
export function repeatMealPayload(entry: MealEntry, now: Date) {
  return {
    consumed_at: now.toISOString(),
    meal_type: mealTypeAt(now),
    notes: null,
    items: entry.items.map((item) =>
      item.food_id
        ? { food_id: item.food_id, quantity: item.quantity }
        : {
            food_id: null,
            quantity: item.quantity,
            unit: item.unit,
            food_name_snapshot: item.food_name_snapshot,
            energy_kcal: item.energy_kcal_snapshot,
            protein_g: item.protein_g_snapshot,
            carbohydrate_g: item.carbohydrate_g_snapshot,
            fat_g: item.fat_g_snapshot,
            fiber_g: item.fiber_g_snapshot,
          },
    ),
  };
}

const DAY_MINUTES = 24 * 60;

function minutesOfDay(value: string): number {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

/** Bed and wake times to start from: the last night logged, else 23:00 to 07:00. */
export function sleepDefaults(latest: SleepEntry | null): { bedMinutes: number; wakeMinutes: number } {
  if (!latest) return { bedMinutes: 23 * 60, wakeMinutes: 7 * 60 };
  return { bedMinutes: minutesOfDay(latest.sleep_start), wakeMinutes: minutesOfDay(latest.sleep_end) };
}

/** A clock time moved by `delta` minutes, wrapping around midnight. */
export function shiftMinutes(minutes: number, delta: number): number {
  return (((minutes + delta) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

export function clockText(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Last night: woke today; went to bed the evening before unless that was after midnight. */
export function sleepWindow(today: Date, bedMinutes: number, wakeMinutes: number): { start: Date; end: Date } {
  const at = (dayOffset: number, minutes: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, Math.floor(minutes / 60), minutes % 60);
  const end = at(0, wakeMinutes);
  const start = at(bedMinutes > wakeMinutes ? -1 : 0, bedMinutes);
  return { start, end };
}

export function sleepPayload(today: Date, bedMinutes: number, wakeMinutes: number, quality: number, timezone: string) {
  const { start, end } = sleepWindow(today, bedMinutes, wakeMinutes);
  return {
    sleep_start: start.toISOString(),
    sleep_end: end.toISOString(),
    timezone,
    quality_score: quality,
  };
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "6 h 55 min". */
export function formatSleepDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
}

function occurrenceStart(occurrence: LoadEventOccurrence): Date {
  const [year, month, day] = occurrence.date.split("-").map(Number);
  const [hour, minute] = occurrence.start_time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

export function occurrenceKey(occurrence: LoadEventOccurrence): string {
  return `${occurrence.event_id}:${occurrence.date}`;
}

interface LoggedActivity {
  activity_type: ActivityType | null;
  performed_at: string;
}

/** Today's hockey that has started but is neither logged nor skipped. */
export function hockeyToConfirm(
  occurrences: LoadEventOccurrence[],
  logs: LoggedActivity[],
  skipped: Set<string>,
  now: Date,
): LoadEventOccurrence[] {
  const today = localIsoDate(now);
  const loggedDays = new Set(
    logs.filter((log) => log.activity_type === "ice_hockey").map((log) => localIsoDate(new Date(log.performed_at))),
  );
  return occurrences.filter(
    (occurrence) =>
      occurrence.date === today &&
      occurrenceStart(occurrence) <= now &&
      !loggedDays.has(occurrence.date) &&
      !skipped.has(occurrenceKey(occurrence)),
  );
}

export function hockeyLogPayload(occurrence: LoadEventOccurrence, feeling: number) {
  return {
    activity_type: "ice_hockey" as const,
    performed_at: occurrenceStart(occurrence).toISOString(),
    total_time_minutes: occurrence.duration_minutes,
    distance_km: null,
    effort_rpe: null,
    overall_feeling: feeling,
    notes: occurrence.name,
    exercises: [],
  };
}

/** The next game or practice that has not started yet, named relative to today. */
export function nextSportEvent(
  occurrences: LoadEventOccurrence[],
  now: Date,
): { occurrence: LoadEventOccurrence; when: string } | null {
  const upcoming = occurrences
    .filter((occurrence) => occurrenceStart(occurrence) > now)
    .sort((a, b) => occurrenceStart(a).getTime() - occurrenceStart(b).getTime());
  const occurrence = upcoming[0];
  if (!occurrence) return null;
  const start = occurrenceStart(occurrence);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const day =
    occurrence.date === localIsoDate(now)
      ? "Today"
      : occurrence.date === localIsoDate(tomorrow)
        ? "Tomorrow"
        : WEEKDAY_LABELS[weekdayIndex(start)];
  return { occurrence, when: `${day} ${clockText(start.getHours() * 60 + start.getMinutes())}` };
}

const SKIPPED_EVENTS_KEY = "workout_logger_skipped_sport_events";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Sport events you marked as not played; kept on this device only. */
export function readSkippedEvents(storage: KeyValueStorage): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SKIPPED_EVENTS_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeSkippedEvent(storage: KeyValueStorage, key: string): void {
  try {
    // Only the recent ones matter; keep the list short.
    const keys = [...readSkippedEvents(storage), key].slice(-30);
    storage.setItem(SKIPPED_EVENTS_KEY, JSON.stringify(keys));
  } catch {
    // A blocked storage only means the card asks again.
  }
}
