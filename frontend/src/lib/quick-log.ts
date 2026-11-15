import type { LoadEventOccurrence, MuscleTag, WorkoutLog } from "@/api/types";
import type { ActivityType } from "./activity";
import { localIsoDate } from "./today";

export type QuickActivity = "swim_sauna" | "ice_hockey";

/** Minutes the hockey button logs when nothing is on today's schedule; the
 * server uses the same default. */
export const HOCKEY_DEFAULT_MINUTES = 75;

/** The shape POST /coach/log takes. Omitted fields take the server defaults
 * (swim + sauna: 30 min, 30 laps, 3 sauna rounds, RPE 5). */
export interface CoachLogBody {
  readiness?: {
    log_date: string;
    soreness: number;
    fatigue: number;
    sore_muscle_groups: MuscleTag[];
  };
  activity?: { type: QuickActivity; duration_minutes?: number };
}

/** Today's scheduled game or practice sets the hockey duration (the longest,
 * if there are two), else the default. */
export function hockeyMinutes(occurrences: LoadEventOccurrence[], today: string): number {
  const todays = occurrences.filter((occurrence) => occurrence.date === today);
  if (todays.length === 0) return HOCKEY_DEFAULT_MINUTES;
  return Math.max(...todays.map((occurrence) => occurrence.duration_minutes));
}

export function activityBody(kind: QuickActivity, minutes?: number): CoachLogBody {
  return kind === "ice_hockey"
    ? { activity: { type: "ice_hockey", duration_minutes: minutes ?? HOCKEY_DEFAULT_MINUTES } }
    : { activity: { type: "swim_sauna" } };
}

/** Energy is asked the friendly way round (higher is better) and saved as
 * fatigue on the 1-10 scale the coach reads: fatigue = 11 - energy. */
export function checkInBody(
  soreness: number,
  energy: number,
  muscles: MuscleTag[],
  now: Date,
): CoachLogBody {
  return {
    readiness: {
      log_date: localIsoDate(now),
      soreness,
      fatigue: 11 - energy,
      sore_muscle_groups: soreness >= 2 ? muscles : [],
    },
  };
}

/** A stand-in log shown in Today's summary until the server answers. */
export function optimisticLog(kind: QuickActivity, now: Date, minutes?: number): WorkoutLog {
  const swim = kind === "swim_sauna";
  const activity: ActivityType = swim ? "swimming" : "ice_hockey";
  return {
    id: `pending-${kind}-${now.getTime()}`,
    source_plan_id: null,
    source_plan_name: swim ? "Swim + sauna" : "Ice hockey",
    performed_at: now.toISOString(),
    total_time_minutes: swim ? 30 : (minutes ?? HOCKEY_DEFAULT_MINUTES),
    calories_burned: null,
    overall_feeling: 4,
    notes: null,
    activity_type: activity,
    distance_km: null,
    effort_rpe: swim ? 5 : 8,
    laps: swim ? 30 : null,
    sauna_rounds: swim ? 3 : null,
    exercises: [],
  };
}

export function isPendingLog(log: { id: string }): boolean {
  return log.id.startsWith("pending-");
}

/** Logs performed on the device's local calendar day, newest first. */
export function logsOn<T extends { performed_at: string }>(logs: T[], day: string): T[] {
  return logs
    .filter((log) => localIsoDate(new Date(log.performed_at)) === day)
    .sort((a, b) => b.performed_at.localeCompare(a.performed_at));
}
