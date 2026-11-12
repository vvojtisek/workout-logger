import type { MovementPattern, MuscleTag } from "@/api/types";

export const MUSCLE_LABELS: Record<MuscleTag, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  full_body: "Full body",
};

export const MOVEMENT_PATTERN_LABELS: Record<MovementPattern, string> = {
  horizontal_push: "Horizontal push",
  horizontal_pull: "Horizontal pull",
  vertical_push: "Vertical push",
  vertical_pull: "Vertical pull",
  squat: "Squat",
  hinge: "Hinge",
  lunge: "Lunge",
  carry: "Carry",
  rotation: "Rotation",
  anti_rotation: "Anti-rotation",
  trunk_flexion: "Trunk flexion",
  trunk_extension: "Trunk extension",
  locomotion: "Locomotion",
};

const PAGE_SIZE = 100;

export function exerciseListPath(
  query: string,
  offset = 0,
  locationId = "",
  movementPattern: MovementPattern | "" = "",
): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  const term = query.trim();
  if (term) params.set("q", term);
  if (locationId) params.set("location_id", locationId);
  if (movementPattern) params.set("movement_pattern", movementPattern);
  return `/exercises?${params.toString()}`;
}

interface NamePage {
  items: { name: string }[];
  total: number;
}

/** Collects every catalogue name, one page at a time, for plan-builder suggestions. */
export async function fetchCatalogueNames(
  fetchPage: (path: string) => Promise<NamePage>,
): Promise<string[]> {
  const names: string[] = [];
  for (;;) {
    const page = await fetchPage(exerciseListPath("", names.length));
    names.push(...page.items.map((item) => item.name));
    if (page.items.length === 0 || names.length >= page.total) return names;
  }
}
