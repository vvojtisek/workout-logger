import type { Units } from "@/api/types";

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

/** Display only: every value is still stored and sent to the API in kg/cm. */
export function formatWeightKg(kg: number, units: Units): string {
  if (units === "imperial") return `${(kg / KG_PER_LB).toFixed(1)} lb`;
  return `${kg.toFixed(1)} kg`;
}

export function formatLengthCm(cm: number, units: Units): string {
  if (units === "imperial") return `${(cm / CM_PER_IN).toFixed(1)} in`;
  return `${cm.toFixed(1)} cm`;
}

/** Same idea as formatWeightKg, but for a signed delta (e.g. a 7-day trend)
 * rather than an absolute reading. */
export function formatWeightDeltaKg(deltaKg: number, units: Units): string {
  const converted = units === "imperial" ? deltaKg / KG_PER_LB : deltaKg;
  const sign = converted > 0 ? "+" : "";
  return `${sign}${converted.toFixed(1)} ${units === "imperial" ? "lb" : "kg"}`;
}
