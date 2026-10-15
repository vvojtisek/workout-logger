import type { EquipmentTag } from "@/api/types";

export const MAX_EQUIPMENT_OPTIONS = 8;

export const EQUIPMENT_LABELS: Record<EquipmentTag, string> = {
  bodyweight: "Bodyweight",
  dumbbell: "Dumbbells",
  kettlebell: "Kettlebell",
  barbell: "Barbell",
  trap_bar: "Trap bar",
  rack: "Rack",
  bench: "Bench",
  pullup_bar: "Pull-up bar",
  cable: "Cable",
  machine: "Machine",
  band: "Band",
  trx: "TRX / rings",
  dip_bars: "Dip bars",
  ab_wheel: "Ab wheel",
  box: "Box / step",
  medicine_ball: "Medicine ball",
  jump_rope: "Jump rope",
  bike: "Bike",
  rower: "Rower",
  treadmill: "Treadmill",
};

/** "Barbell + Bench, or Bench + Dumbbells"; empty when untagged. */
export function describeEquipmentOptions(options: EquipmentTag[][]): string {
  return options
    .map((option) => option.map((tag) => EQUIPMENT_LABELS[tag]).join(" + "))
    .join(", or ");
}

export function toggleEquipmentTag(
  options: EquipmentTag[][],
  index: number,
  tag: EquipmentTag,
): EquipmentTag[][] {
  return options.map((option, i) => {
    if (i !== index) return option;
    return option.includes(tag) ? option.filter((t) => t !== tag) : [...option, tag];
  });
}

/** Mirrors the server's limits so the form can explain them before saving. */
export function equipmentOptionsError(options: EquipmentTag[][]): string | null {
  if (options.length > MAX_EQUIPMENT_OPTIONS) {
    return `At most ${MAX_EQUIPMENT_OPTIONS} alternatives.`;
  }
  const empty = options.findIndex((option) => option.length === 0);
  if (empty !== -1) {
    return `Option ${empty + 1} has nothing picked. Pick something or remove it.`;
  }
  return null;
}
