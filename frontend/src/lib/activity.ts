import { EFFORT_SCALE, FEELING_SCALE, scaleText } from "./scales";

export const ACTIVITY_TYPES = [
  "ice_hockey",
  "swimming",
  "cycling",
  "hiking",
  "running",
  "other",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const LABELS: Record<ActivityType, string> = {
  ice_hockey: "Ice hockey",
  swimming: "Swimming",
  cycling: "Cycling",
  hiking: "Hiking",
  running: "Running",
  other: "Other activity",
};

export function activityLabel(type: ActivityType): string {
  return LABELS[type];
}

interface LogLike {
  performed_at: string;
  total_time_minutes: number;
  overall_feeling: number;
  source_plan_name: string | null;
  activity_type: ActivityType | null;
  distance_km: number | null;
  effort_rpe: number | null;
}

export function logTitle(log: LogLike): string {
  if (log.activity_type) return activityLabel(log.activity_type);
  return log.source_plan_name || new Date(log.performed_at).toLocaleString();
}

/** Session load is RPE (CR-10) times minutes, the usual session-RPE training load. */
export function logSummaryFacts(log: LogLike): string[] {
  const facts = [`${log.total_time_minutes} min`];
  if (log.distance_km != null) facts.push(`${log.distance_km} km`);
  if (log.effort_rpe != null) {
    facts.push(`Effort ${scaleText(EFFORT_SCALE, log.effort_rpe)}`);
    facts.push(`Load ${log.effort_rpe * log.total_time_minutes}`);
  }
  facts.push(`Feeling ${scaleText(FEELING_SCALE, log.overall_feeling)}`);
  return facts;
}
