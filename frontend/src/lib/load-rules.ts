// How an exercise's typed weight and reps become volume. The server computes
// volume (app/services/volume.py); these helpers only label the inputs.

export const EQUIPMENT_LOAD_MODES = ["standard", "single_db", "pair_db"] as const;
export type EquipmentLoadMode = (typeof EQUIPMENT_LOAD_MODES)[number];

export interface LoadRule {
  equipment_load_mode?: EquipmentLoadMode;
  is_unilateral?: boolean;
}

export const LOAD_MODE_LABELS: Record<EquipmentLoadMode, string> = {
  standard: "Barbell, machine or other: volume uses the weight as typed",
  single_db: "One dumbbell: type its weight, volume counts it once",
  pair_db: "Two dumbbells, one per hand: type one dumbbell, volume counts it twice",
};

/** Shown next to the weight input; null for a barbell or machine lift. */
export function weightHint(rule: LoadRule): string | null {
  switch (rule.equipment_load_mode) {
    case "pair_db":
      return "Input: 1x DB (Vol: 2x)";
    case "single_db":
      return "Input: 1x DB";
    default:
      return null;
  }
}

/** Shown next to the reps input when one set means the same reps on each side. */
export function repsHint(rule: LoadRule): string | null {
  return rule.is_unilateral ? "per side" : null;
}

/** Reps of a logged set or log line, marked per side where that applies. */
export function repsText(reps: string, rule: LoadRule): string {
  return rule.is_unilateral ? `${reps} reps per side` : `${reps} reps`;
}

export function formatVolumeKg(value: number): string {
  return `${Math.round(value).toLocaleString("en-US").replace(/,/g, " ")} kg`;
}

/** One line for the exercise page; null for a plain barbell or machine lift. */
export function loadRuleText(rule: LoadRule): string | null {
  const parts: string[] = [];
  if (rule.equipment_load_mode === "pair_db") parts.push("Type one dumbbell; volume counts both.");
  if (rule.equipment_load_mode === "single_db") parts.push("Type the dumbbell's weight.");
  if (rule.is_unilateral) parts.push("Reps are per side; volume counts both sides.");
  return parts.length > 0 ? parts.join(" ") : null;
}
