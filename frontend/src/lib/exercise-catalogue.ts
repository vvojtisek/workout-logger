import type { CatalogExercise, MovementPattern, MuscleTag, Paginated } from "@/api/types";

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

const PAGE_SIZE = 100;

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
  core_stability: "Core stability",
  locomotion: "Locomotion",
};

export function exerciseListPath(
  query: string,
  offset = 0,
  locationId = "",
  movementPattern = "",
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

/** Fetches catalogue metadata for local planning summaries, one page at a time. */
export async function fetchCatalogueExercises(
  fetchPage: (path: string) => Promise<Paginated<CatalogExercise>>,
): Promise<CatalogExercise[]> {
  const exercises: CatalogExercise[] = [];
  for (;;) {
    const page = await fetchPage(exerciseListPath("", exercises.length));
    exercises.push(...page.items);
    if (page.items.length === 0 || exercises.length >= page.total) return exercises;
  }
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
