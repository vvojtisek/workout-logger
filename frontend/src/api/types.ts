import type { ExerciseKind, GridExercise, GridSession } from "@/lib/workout-utils";

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
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
