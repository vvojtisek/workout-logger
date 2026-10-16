import type { LoadEvent, LoadEventKind, LoadEventOccurrence } from "@/api/types";

import { WEEKDAY_LABELS } from "./program-templates";

export const LOAD_EVENT_KIND_LABELS: Record<LoadEventKind, string> = {
  game: "Game",
  practice: "Practice",
};

/** Mirrors MAX_SEASON_DAYS in `app/schemas/load_events.py`. */
const MAX_SEASON_DAYS = 366;

export interface LoadEventPayload {
  name: string;
  kind: LoadEventKind;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  season_start: string;
  season_end: string;
}

/** The editable form of a load event: numbers stay text while typing. */
export interface LoadEventDraft {
  name: string;
  kind: LoadEventKind;
  weekday: number;
  startTime: string;
  minutes: string;
  seasonStart: string;
  seasonEnd: string;
}

/** "19:30:00" from the API as "19:30". */
export function clockTime(value: string): string {
  return value.slice(0, 5);
}

export function describeLoadEvent(event: Pick<LoadEvent, "weekday" | "start_time" | "duration_minutes">): string {
  return `${WEEKDAY_LABELS[event.weekday]} ${clockTime(event.start_time)}, ${event.duration_minutes} min`;
}

/** The ice hockey season (1 September to 31 March) that is running now, or
 * the next one once the current one has ended. */
export function defaultSeason(today: Date): { start: string; end: string } {
  const year = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  const endOfSeason = new Date(year + 1, 2, 31);
  const startYear = today > endOfSeason ? year + 1 : year;
  return { start: `${startYear}-09-01`, end: `${startYear + 1}-03-31` };
}

export function emptyDraft(today: Date = new Date()): LoadEventDraft {
  const season = defaultSeason(today);
  return {
    name: "",
    kind: "practice",
    weekday: 1,
    startTime: "",
    minutes: "60",
    seasonStart: season.start,
    seasonEnd: season.end,
  };
}

export function draftFromLoadEvent(event: LoadEvent): LoadEventDraft {
  return {
    name: event.name,
    kind: event.kind,
    weekday: event.weekday,
    startTime: clockTime(event.start_time),
    minutes: String(event.duration_minutes),
    seasonStart: event.season_start,
    seasonEnd: event.season_end,
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Mirrors `app/schemas/load_events.py`. */
export function draftToPayload(
  draft: LoadEventDraft,
): { ok: true; payload: LoadEventPayload } | { ok: false; error: string } {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > 100) return { ok: false, error: "Name is at most 100 characters." };
  if (!draft.startTime.trim()) return { ok: false, error: "Start time is required." };
  const clock = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(draft.startTime.trim());
  if (!clock) return { ok: false, error: "Start time is a 24-hour time such as 19:30." };
  const startTime = `${clock[1].padStart(2, "0")}:${clock[2]}`;
  const minutes = Number(draft.minutes);
  if (!draft.minutes.trim() || !Number.isInteger(minutes) || minutes < 15 || minutes > 300) {
    return { ok: false, error: "Duration is a whole number from 15 to 300 minutes." };
  }
  if (!draft.seasonStart || !draft.seasonEnd) {
    return { ok: false, error: "Season start and end are required." };
  }
  const span = daysBetween(draft.seasonStart, draft.seasonEnd);
  if (span < 0) return { ok: false, error: "The season must end on or after it starts." };
  if (span > MAX_SEASON_DAYS) return { ok: false, error: `A season is at most ${MAX_SEASON_DAYS} days.` };
  return {
    ok: true,
    payload: {
      name,
      kind: draft.kind,
      weekday: draft.weekday,
      start_time: startTime,
      duration_minutes: minutes,
      season_start: draft.seasonStart,
      season_end: draft.seasonEnd,
    },
  };
}

export function draftIsDirty(draft: LoadEventDraft, saved: LoadEvent): boolean {
  const result = draftToPayload(draft);
  if (!result.ok) return true;
  const { payload } = result;
  return (
    payload.name !== saved.name ||
    payload.kind !== saved.kind ||
    payload.weekday !== saved.weekday ||
    payload.start_time !== clockTime(saved.start_time) ||
    payload.duration_minutes !== saved.duration_minutes ||
    payload.season_start !== saved.season_start ||
    payload.season_end !== saved.season_end
  );
}

/** Calendar occurrences keyed by ISO date, in the order the API sent them. */
export function occurrencesByDate(
  occurrences: LoadEventOccurrence[],
): Map<string, LoadEventOccurrence[]> {
  const byDate = new Map<string, LoadEventOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = byDate.get(occurrence.date) ?? [];
    list.push(occurrence);
    byDate.set(occurrence.date, list);
  }
  return byDate;
}
