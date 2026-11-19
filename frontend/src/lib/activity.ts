import { formatDateTime } from "./format";
import { formatVolumeKg } from "./load-rules";
import { EFFORT_LEVEL_SCALE, EFFORT_SCALE, FEELING_SCALE, scaleText } from "./scales";

export const ACTIVITY_TYPES = [
  "ice_hockey",
  "swimming",
  "sauna",
  "cycling",
  "hiking",
  "running",
  "other",
  "meditation",
  "stretching",
  "cold_plunge",
  "hot_tub",
  "massage",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type ActivityCategory = "strength" | "cardio" | "recovery";

/** Mirrors CARDIO_TYPES / RECOVERY_TYPES in app/services/activity_kinds.py. */
export const CARDIO_TYPES = ["ice_hockey", "swimming", "cycling", "hiking", "running", "other"] as const;
export const RECOVERY_TYPES = ["sauna", "stretching", "meditation", "cold_plunge", "hot_tub", "massage"] as const;
export type CardioType = (typeof CARDIO_TYPES)[number];
export type RecoveryType = (typeof RECOVERY_TYPES)[number];

export function isRecoveryType(type: ActivityType | null | undefined): type is RecoveryType {
  return type != null && (RECOVERY_TYPES as readonly string[]).includes(type);
}

const LABELS: Record<ActivityType, string> = {
  ice_hockey: "Ice hockey",
  swimming: "Swimming",
  sauna: "Sauna",
  cycling: "Cycling",
  hiking: "Hiking",
  running: "Running",
  other: "Other activity",
  meditation: "Meditation",
  stretching: "Stretching",
  cold_plunge: "Cold plunge",
  hot_tub: "Hot tub (Jacuzzi)",
  massage: "Massage",
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
  laps?: number | null;
  sauna_rounds?: number | null;
  total_volume_kg?: number;
  activity_name?: string | null;
  effort_level?: number | null;
  cycles?: number | null;
  cycle_minutes?: number | null;
}

export function logTitle(log: LogLike): string {
  if (log.activity_type === "other" && log.activity_name) return log.activity_name;
  if (log.activity_type) return activityLabel(log.activity_type);
  return log.source_plan_name || formatDateTime(log.performed_at);
}

/** Session load is RPE (CR-10) times minutes, the usual session-RPE training load. */
export function logSummaryFacts(log: LogLike): string[] {
  const facts = [`${log.total_time_minutes} min`];
  if (log.distance_km != null) facts.push(`${log.distance_km} km`);
  if (log.laps != null) facts.push(`${log.laps} laps`);
  if (log.cycles) {
    const each = log.cycle_minutes ? ` × ${log.cycle_minutes} min` : "";
    facts.push(`${log.cycles} ${log.cycles === 1 ? "cycle" : "cycles"}${each}`);
  } else if (log.sauna_rounds) {
    facts.push(`${log.sauna_rounds} sauna ${log.sauna_rounds === 1 ? "round" : "rounds"}`);
  }
  if (log.effort_level != null) facts.push(`Effort ${scaleText(EFFORT_LEVEL_SCALE, log.effort_level)}`);
  else if (log.effort_rpe != null) facts.push(`Effort ${scaleText(EFFORT_SCALE, log.effort_rpe)}`);
  if (log.effort_rpe != null) facts.push(`Load ${log.effort_rpe * log.total_time_minutes}`);
  facts.push(`Feeling ${scaleText(FEELING_SCALE, log.overall_feeling)}`);
  if (log.total_volume_kg) facts.push(`Volume ${formatVolumeKg(log.total_volume_kg)}`);
  return facts;
}
