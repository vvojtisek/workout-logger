import type { Units } from "@/api/types";

/** Values are stored and displayed in metric units throughout the app. */
export function formatWeightKg(kg: number, _legacyUnits?: Units): string {
  return `${kg.toFixed(1)} kg`;
}

export function formatLengthCm(cm: number, _legacyUnits?: Units): string {
  return `${cm.toFixed(1)} cm`;
}

/** Format a signed change in stored metric weight. */
export function formatWeightDeltaKg(deltaKg: number, _legacyUnits?: Units): string {
  const sign = deltaKg > 0 ? "+" : "";
  return `${sign}${deltaKg.toFixed(1)} kg`;
}
