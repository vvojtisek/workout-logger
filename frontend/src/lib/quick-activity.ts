// The cardio and recovery quick-log forms: the prefill the server predicts
// (GET /activities/defaults), how it fills the fields the person has not
// touched, and the POST /coach/log body each form sends.
import type { ActivityType, CardioType, RecoveryType } from "./activity";
import { localIsoDate } from "./today";

export type PrefillCategory = "cardio" | "recovery";

export interface TypeDefaults {
  activity_type: ActivityType;
  activity_name: string | null;
  start_time: string | null;
  started_at: string | null;
  duration_minutes: number;
  effort_level: number | null;
  cycles: number | null;
  cycle_minutes: number | null;
  observations: number;
  same_weekday_observations: number;
  basis: "same_weekday" | "recent" | "default";
}

export interface RecoveryPreset {
  label: string;
  activity_type: RecoveryType;
  duration_minutes: number;
  cycles: number | null;
  cycle_minutes: number | null;
  times_logged: number;
}

export interface LinkCandidate {
  id: string;
  activity_type: ActivityType | null;
  name: string | null;
  performed_at: string;
}

export interface ActivityDefaults {
  date: string;
  day_of_week: number;
  season: "winter" | "summer";
  category: PrefillCategory;
  timezone: string;
  weeks: number;
  history_entries: number;
  suggested: TypeDefaults;
  ranked: TypeDefaults[];
  time_slots: string[];
  presets: RecoveryPreset[];
  link_candidates: LinkCandidate[];
}

export const DURATION_PRESETS = [30, 45, 60, 90] as const;
export const RECOVERY_DURATION_PRESETS = [5, 10, 15, 30, 45] as const;
export const SLOT_MINUTES = 15;

export function defaultsPath(category: PrefillCategory, day: string, timezone: string): string {
  const query = new URLSearchParams({ category, date: day, timezone });
  return `/activities/defaults?${query.toString()}`;
}

/** Today and yesterday as the device's calendar days, for the one-tap day chips. */
export function dayChoices(now: Date): { label: string; value: string }[] {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return [
    { label: "Today", value: localIsoDate(now) },
    { label: "Yesterday", value: localIsoDate(yesterday) },
  ];
}

/** The device's clock rounded to the nearest 15-minute slot, "HH:MM". */
export function nowSlot(now: Date): string {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const rounded = (Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES) % (24 * 60);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

/** A local calendar day and "HH:MM" as a UTC ISO timestamp; null if either is malformed. */
export function localDateTimeToIso(day: string, clock: string): string | null {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const clockMatch = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!dayMatch || !clockMatch) return null;
  const [year, month, date] = [Number(dayMatch[1]), Number(dayMatch[2]), Number(dayMatch[3])];
  const [hour, minute] = [Number(clockMatch[1]), Number(clockMatch[2])];
  if (hour > 23 || minute > 59) return null;
  const value = new Date(year, month - 1, date, hour, minute);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== date) {
    return null;
  }
  return value.toISOString();
}

/** Time chips: the weekday's usual starts, the predicted one first, and now. */
export function timeChoices(defaults: ActivityDefaults | undefined, predicted: string | null, now: string): string[] {
  const ordered = [predicted, ...(defaults?.time_slots ?? []), now].filter(
    (slot): slot is string => slot != null,
  );
  return [...new Set(ordered)].slice(0, 4);
}

/** Duration pills: the presets plus the predicted value when it is not one of them. */
export function durationChoices(presets: readonly number[], predicted: number | null): number[] {
  const values = new Set<number>(presets);
  if (predicted != null) values.add(predicted);
  return [...values].sort((a, b) => a - b);
}

export function rankedTypes<T extends ActivityType>(defaults: ActivityDefaults | undefined, fallback: readonly T[]): T[] {
  if (!defaults) return [...fallback];
  const ranked = defaults.ranked.map((item) => item.activity_type as T).filter((type) => fallback.includes(type));
  return [...ranked, ...fallback.filter((type) => !ranked.includes(type))];
}

export function defaultsFor(defaults: ActivityDefaults | undefined, type: ActivityType): TypeDefaults | undefined {
  return defaults?.ranked.find((item) => item.activity_type === type);
}

export type QuickField = "type" | "time" | "duration" | "effort" | "cycles" | "name";

export interface QuickForm<T extends ActivityType> {
  type: T;
  day: string;
  time: string;
  duration: number;
  effort: number | null;
  feelBefore: number | null;
  feelAfter: number | null;
  cycles: number | null;
  cycleMinutes: number | null;
  name: string;
  /** null: no link; "auto": the server links it to the session before. */
  linkedLogId: string | null;
}

/** Fills every field the person has not touched from the prediction for the
 * form's type (or the suggested type, if the type is untouched). */
export function applyPrefill<T extends ActivityType>(
  form: QuickForm<T>,
  defaults: ActivityDefaults,
  touched: ReadonlySet<QuickField>,
  allowed: readonly T[],
  now: string,
): QuickForm<T> {
  const suggested = defaults.suggested.activity_type as T;
  const type = touched.has("type") || !allowed.includes(suggested) ? form.type : suggested;
  const prediction = defaultsFor(defaults, type);
  if (!prediction) return { ...form, type };
  return {
    ...form,
    type,
    time: touched.has("time") ? form.time : (prediction.start_time ?? now),
    duration: touched.has("duration") ? form.duration : prediction.duration_minutes,
    effort: touched.has("effort") ? form.effort : prediction.effort_level,
    cycles: touched.has("cycles") ? form.cycles : prediction.cycles,
    cycleMinutes: touched.has("cycles") ? form.cycleMinutes : prediction.cycle_minutes,
    name: touched.has("name") ? form.name : (prediction.activity_name ?? form.name),
  };
}

export interface CoachActivityBody {
  type: ActivityType;
  performed_at: string;
  duration_minutes: number;
  effort_level?: number;
  feel_before?: number;
  feel_after?: number;
  cycles?: number;
  cycle_minutes?: number;
  activity_name?: string;
  linked_log_id?: string;
  link_to_previous?: boolean;
}

/** The /coach/log activity for a filled form, or the first problem to show. */
export function quickActivityBody<T extends ActivityType>(
  form: QuickForm<T>,
  { requireEffort }: { requireEffort: boolean },
): { body: CoachActivityBody; error: null } | { body: null; error: string } {
  const performedAt = localDateTimeToIso(form.day, form.time);
  if (!performedAt) return { body: null, error: "Pick a day and a start time." };
  if (!Number.isInteger(form.duration) || form.duration < 1 || form.duration > 600) {
    return { body: null, error: "Duration must be 1 to 600 minutes." };
  }
  if (requireEffort && form.effort == null) return { body: null, error: "Pick how hard it was (1-5)." };
  const body: CoachActivityBody = {
    type: form.type,
    performed_at: performedAt,
    duration_minutes: form.duration,
  };
  if (form.effort != null) body.effort_level = form.effort;
  if (form.feelBefore != null) body.feel_before = form.feelBefore;
  if (form.feelAfter != null) body.feel_after = form.feelAfter;
  if (form.cycles != null) body.cycles = form.cycles;
  if (form.cycles != null && form.cycleMinutes != null) body.cycle_minutes = form.cycleMinutes;
  const name = form.name.trim();
  if (form.type === "other" && name) body.activity_name = name.slice(0, 60);
  if (form.linkedLogId === null) body.link_to_previous = false;
  else if (form.linkedLogId !== "auto") body.linked_log_id = form.linkedLogId;
  return { body, error: null };
}

/** A one-tap recovery card's body: logged now, linked by the server to the
 * training session just before it. */
export function presetBody(preset: RecoveryPreset, now: Date): CoachActivityBody {
  const body: CoachActivityBody = {
    type: preset.activity_type,
    performed_at: now.toISOString(),
    duration_minutes: preset.duration_minutes,
  };
  if (preset.cycles != null) body.cycles = preset.cycles;
  if (preset.cycle_minutes != null) body.cycle_minutes = preset.cycle_minutes;
  return body;
}

export function newQuickForm<T extends ActivityType>(type: T, now: Date): QuickForm<T> {
  return {
    type,
    day: localIsoDate(now),
    time: nowSlot(now),
    duration: 30,
    effort: null,
    feelBefore: null,
    feelAfter: null,
    cycles: null,
    cycleMinutes: null,
    name: "",
    linkedLogId: "auto",
  };
}

export type { CardioType, RecoveryType };
