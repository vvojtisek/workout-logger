import type { ExerciseKind, GridExercise, GridSession } from "@/lib/workout-utils";
import type { ActivityType } from "@/lib/activity";

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export const ROLES = ["admin", "user"] as const;
export type Role = (typeof ROLES)[number];

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanExercise {
  id: string;
  sort_order: number;
  exercise_name: string;
  exercise_kind: ExerciseKind;
  target_sets: number;
  target_reps_min: number;
  target_reps_max: number;
  target_weight_kg: number | null;
  rest_time_seconds: number;
  notes: string | null;
  group_key: string | null;
  group_order: number | null;
}

export interface WorkoutPlan {
  id: string;
  name: string;
  description: string | null;
  exercises: PlanExercise[];
  created_at: string;
  updated_at: string;
}

export interface SessionExercise extends GridExercise {
  target_reps_min: number;
  target_reps_max: number;
  target_weight_kg: number | null;
  rest_time_seconds: number;
  notes: string | null;
  status: string;
}

export interface WorkoutSession extends GridSession {
  id: string;
  source_plan_id: string | null;
  source_plan_name: string;
  location_id: string | null;
  workout_log_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  rest_ends_at: string | null;
  version: number;
  exercises: SessionExercise[];
}

/** One past session of an exercise, for the progression chart. */
export interface ExerciseSessionPoint {
  performed_at: string;
  weight_kg: number | null;
  top_reps: number;
  estimated_one_rep_max_kg: number | null;
}

export interface ExerciseStats {
  exercise_name: string;
  sessions_count: number;
  last_performed_at: string | null;
  last_weight_kg: number | null;
  last_reps_per_set: number[] | null;
  best_weight_kg: number | null;
  best_weight_reps: number | null;
  estimated_one_rep_max_kg: number | null;
  trend: "up" | "down" | "flat" | null;
  /** Up to the last twelve sessions, oldest first. */
  recent: ExerciseSessionPoint[];
}

export interface ExerciseStatsResponse {
  items: ExerciseStats[];
}

export interface ExerciseLog {
  id: string;
  exercise_name: string;
  sets_count: number;
  reps_per_set: number[];
  weight_kg: number | null;
  rest_time_seconds: number;
  notes: string | null;
}

export interface WorkoutLogSummary {
  id: string;
  source_plan_id: string | null;
  source_plan_name: string | null;
  performed_at: string;
  total_time_minutes: number;
  calories_burned: number | null;
  overall_feeling: number;
  notes: string | null;
  activity_type: ActivityType | null;
  distance_km: number | null;
  effort_rpe: number | null;
}

export interface WorkoutLog extends WorkoutLogSummary {
  exercises: ExerciseLog[];
}

export const MUSCLE_TAGS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "core",
  "full_body",
] as const;

export type MuscleTag = (typeof MUSCLE_TAGS)[number];

// Mirrors `EquipmentTag` in `app/schemas/exercises.py`.
export const EQUIPMENT_TAGS = [
  "bodyweight",
  "dumbbell",
  "kettlebell",
  "barbell",
  "trap_bar",
  "rack",
  "bench",
  "pullup_bar",
  "cable",
  "machine",
  "band",
  "trx",
  "dip_bars",
  "ab_wheel",
  "box",
  "medicine_ball",
  "jump_rope",
  "bike",
  "rower",
  "treadmill",
] as const;

export type EquipmentTag = (typeof EQUIPMENT_TAGS)[number];

export interface CatalogExercise {
  id: string;
  name: string;
  aliases: string[];
  media_url: string | null;
  primary_muscles: MuscleTag[];
  secondary_muscles: MuscleTag[];
  instructions: string[];
  equipment: string | null;
  // Alternatives: any one option will do, and an option needs all its tags.
  // Empty means the exercise is not tagged.
  equipment_any_of: EquipmentTag[][];
  safety_notes: string | null;
  created_at: string;
  updated_at: string;
}

export const LOCATION_KINDS = ["home", "office", "gym", "travel"] as const;

export type LocationKind = (typeof LOCATION_KINDS)[number];

export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
  // What the place has; bodyweight is implied everywhere.
  equipment: EquipmentTag[];
  default_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface LocationCheck {
  location: { id: string; name: string } | null;
  items: Array<{
    session_exercise_id: string;
    exercise_name: string;
    needs: EquipmentTag[][];
    swaps: Array<{ exercise_name: string; exercise_kind: ExerciseKind }>;
  }>;
}

export const LOAD_EVENT_KINDS = ["game", "practice"] as const;

export type LoadEventKind = (typeof LOAD_EVENT_KINDS)[number];

/** A weekly game or practice for one season. Monday is weekday 0. */
export interface LoadEvent {
  id: string;
  name: string;
  kind: LoadEventKind;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  season_start: string;
  season_end: string;
  created_at: string;
  updated_at: string;
}

export interface LoadEventOccurrence {
  event_id: string;
  date: string;
  start_time: string;
  duration_minutes: number;
  kind: LoadEventKind;
  name: string;
}

/** A scheduled workout with heavy leg work too close before a game or practice. */
export interface LoadWarning {
  scheduled_workout_id: string;
  heavy_exercises: string[];
  events: LoadEventOccurrence[];
  move_to: string | null;
  swap_plans: Array<{ id: string; name: string }>;
}

export type ProgramStatus = "active" | "completed" | "archived";

export interface Program {
  id: string;
  name: string;
  kind: string;
  start_date: string;
  end_date: string | null;
  status: ProgramStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramTemplate {
  key: string;
  name: string;
  kind: string;
  location: string;
  summary: string;
  schedule_type: "sequence" | "weekly";
  session_count: number;
  max_sessions_per_week: number | null;
  default_weekdays: number[] | null;
  plan_names: string[];
}

export interface ProgramTemplateInstallResult {
  program: Program;
  plan_ids: string[];
  scheduled_count: number;
}

export type ScheduledWorkoutStatus = "scheduled" | "in_progress" | "completed" | "skipped";

export interface ScheduledWorkout {
  id: string;
  program_id: string | null;
  program_name: string | null;
  workout_plan_id: string;
  workout_plan_name: string;
  scheduled_date: string;
  status: ScheduledWorkoutStatus;
  notes: string | null;
  workout_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BodyMetric {
  id: string;
  measured_at: string;
  weight_kg: number;
  body_fat_percent: number | null;
  neck_cm: number | null;
  chest_cm: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  biceps_cm: number | null;
  forearms_cm: number | null;
  thighs_cm: number | null;
  calves_cm: number | null;
  created_at: string;
  updated_at: string;
}

export interface BodyMetricTrends {
  latest: BodyMetric | null;
  weight_kg_delta_7d: number | null;
  weight_kg_delta_14d: number | null;
  body_fat_percent_delta_7d: number | null;
  body_fat_percent_delta_14d: number | null;
}

export interface Food {
  id: string;
  name: string;
  brand: string | null;
  serving_quantity: number;
  serving_unit: string;
  energy_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  fat_g: number;
  fiber_g: number | null;
  source: string;
  catalog_id: string | null;
  category: string | null;
  vitamins_mg: Record<string, number> | null;
  minerals_mg: Record<string, number> | null;
  created_at: string;
  updated_at: string;
}

/** An entry of the bundled fallback catalogue, per 100 g. `food_id` is set
 * once it has been added to the foods. */
export interface CatalogFood {
  catalog_id: string;
  name: string;
  category: string;
  serving_quantity: number;
  serving_unit: string;
  energy_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  fat_g: number;
  fiber_g: number;
  vitamins_mg: Record<string, number>;
  minerals_mg: Record<string, number>;
  food_id: string | null;
}

export interface CatalogSearchResponse {
  items: CatalogFood[];
  total: number;
  limit: number;
}

export interface NutritionPlan {
  id: string;
  name: string;
  valid_from: string;
  valid_to: string | null;
  energy_target_kcal: number;
  protein_target_g: number;
  carbohydrate_target_g: number;
  fat_target_g: number;
  fiber_target_g: number | null;
  created_at: string;
  updated_at: string;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface MealItem {
  id: string;
  food_id: string | null;
  food_name_snapshot: string;
  quantity: number;
  unit: string;
  energy_kcal_snapshot: number;
  protein_g_snapshot: number;
  carbohydrate_g_snapshot: number;
  fat_g_snapshot: number;
  fiber_g_snapshot: number | null;
}

export interface MealEntry {
  id: string;
  consumed_at: string;
  meal_type: MealType;
  notes: string | null;
  items: MealItem[];
  created_at: string;
  updated_at: string;
}

export interface NutritionTotals {
  energy_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface NutritionTarget {
  nutrition_plan_id: string;
  name: string;
  energy_target_kcal: number;
  protein_target_g: number;
  carbohydrate_target_g: number;
  fat_target_g: number;
  fiber_target_g: number | null;
}

export interface NutritionRemaining {
  energy_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  fat_g: number;
  fiber_g: number | null;
}

export interface NutritionDailySummary {
  date: string;
  totals: NutritionTotals;
  target: NutritionTarget | null;
  remaining: NutritionRemaining | null;
}

export interface SleepEntry {
  id: string;
  sleep_start: string;
  sleep_end: string;
  timezone: string;
  sleep_date: string;
  time_in_bed_seconds: number;
  estimated_sleep_seconds: number | null;
  awake_seconds: number | null;
  quality_score: number | null;
  resting_heart_rate: number | null;
  notes: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface SleepTrends {
  latest: SleepEntry | null;
  average_sleep_seconds_7d: number | null;
  average_sleep_seconds_30d: number | null;
  average_quality_score_7d: number | null;
  average_quality_score_30d: number | null;
}

export const API_TOKEN_SCOPES = ["read", "log", "admin"] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export interface ApiToken {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiTokenCreated extends ApiToken {
  token: string;
}

/** Legacy API values remain typed for compatibility; the UI always displays metric. */
export type Units = "metric" | "imperial";

export interface UserSettings {
  id: string;
  units: Units;
  default_rest_compound_seconds: number;
  default_rest_isolation_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface CoachingPrinciples {
  body: string;
  updated_at: string | null;
}

export const MAX_PRINCIPLES_LENGTH = 20_000;

export interface McpStatus {
  enabled: boolean;
  path: string;
  tool_count: number;
  tools: McpToolInfo[];
}
