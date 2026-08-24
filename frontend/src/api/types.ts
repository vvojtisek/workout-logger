import type { ExerciseKind, GridExercise, GridSession } from "@/lib/workout-utils";

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
  workout_log_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  rest_ends_at: string | null;
  version: number;
  exercises: SessionExercise[];
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

export interface CatalogExercise {
  id: string;
  name: string;
  aliases: string[];
  media_url: string | null;
  primary_muscles: MuscleTag[];
  secondary_muscles: MuscleTag[];
  instructions: string[];
  equipment: string | null;
  safety_notes: string | null;
  created_at: string;
  updated_at: string;
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

export type ScheduledWorkoutStatus = "scheduled" | "in_progress" | "completed" | "skipped";

export interface ScheduledWorkout {
  id: string;
  program_id: string | null;
  program_name: string | null;
  workout_plan_id: string;
  workout_plan_name: string;
  scheduled_date: string;
  status: ScheduledWorkoutStatus;
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
  created_at: string;
  updated_at: string;
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

export const UNITS = ["metric", "imperial"] as const;

export type Units = (typeof UNITS)[number];

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

export interface McpStatus {
  enabled: boolean;
  path: string;
  tool_count: number;
  tools: McpToolInfo[];
}
