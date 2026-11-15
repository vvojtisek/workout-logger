from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.athlete_profile import DietaryConstraint
from app.schemas.common import require_non_empty, require_timezone_aware_utc
from app.schemas.logs import WorkoutLogRead
from app.schemas.meal_plans import DayPlanRead, SupplementRead
from app.schemas.plans import ExerciseKind, WorkoutPlanRead
from app.schemas.readiness import ReadinessLogCreate, ReadinessLogRead
from app.schemas.scheduled_workouts import ScheduledWorkoutRead

CoachActivityType = Literal[
    "ice_hockey",
    "swimming",
    "swim_sauna",
    "sauna",
    "gym",
    "cycling",
    "hiking",
    "running",
    "other",
    "meditation",
    "stretching",
    "cold_plunge",
]


class CoachActivityIn(BaseModel):
    type: CoachActivityType = Field(
        description=(
            "swim_sauna = a swim followed by sauna rounds, saved as one swim. Omitted fields "
            "use defaults: hockey 75 min RPE 8; swim 30 min 30 laps RPE 5; swim_sauna adds "
            "3 sauna rounds; sauna 45 min 3 cycles; gym 45 min RPE 7; meditation and "
            "stretching 15 min; cold plunge 5 min. Sauna, meditation, stretching and "
            "cold_plunge are recovery and add no training load."
        )
    )
    performed_at: datetime | None = Field(default=None, description="Omitted: now.")
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    effort_rpe: int | None = Field(default=None, ge=1, le=10, description="Session RPE, CR-10.")
    overall_feeling: int | None = Field(
        default=None, ge=1, le=5, description="1 awful, 5 great. Omitted: 4."
    )
    laps: int | None = Field(default=None, ge=0, le=1000)
    sauna_rounds: int | None = Field(default=None, ge=0, le=20)
    distance_km: float | None = Field(default=None, ge=0, le=1000)
    notes: str | None = Field(default=None, max_length=2000)
    activity_name: str | None = Field(
        default=None, max_length=60, description='Custom name for an "other" activity.'
    )
    effort_level: int | None = Field(
        default=None,
        ge=1,
        le=5,
        description="Effort 1-5 (1 relaxed, 3 moderate, 5 max). Sets effort_rpe when that is "
        "omitted.",
    )
    feel_before: int | None = Field(
        default=None, ge=1, le=5, description="1 wrecked, 2 fatigued, 3 sore, 4 normal, 5 fresh."
    )
    feel_after: int | None = Field(
        default=None,
        ge=1,
        le=5,
        description="Same scale as feel_before; also the overall_feeling when that is omitted.",
    )
    cycles: int | None = Field(default=None, ge=1, le=20, description="Recovery rounds.")
    cycle_minutes: int | None = Field(
        default=None,
        ge=1,
        le=240,
        description="Minutes per round; with cycles it gives the duration when that is omitted.",
    )
    linked_log_id: UUID | None = Field(
        default=None, description="The session this one followed, e.g. the swim before a sauna."
    )
    link_to_previous: bool = Field(
        default=True,
        description="For a recovery entry with no linked_log_id: link it to the latest "
        "training session that started up to 6 hours before it.",
    )

    @field_validator("performed_at")
    @classmethod
    def performed_at_requires_timezone(cls, value: datetime | None) -> datetime | None:
        return None if value is None else require_timezone_aware_utc(value)


class CoachLogRequest(BaseModel):
    readiness: ReadinessLogCreate | None = None
    activity: CoachActivityIn | None = None

    @model_validator(mode="after")
    def has_something(self) -> "CoachLogRequest":
        if self.readiness is None and self.activity is None:
            raise ValueError("give readiness, activity, or both")
        return self


class CoachLogResult(BaseModel):
    readiness_log: ReadinessLogRead | None
    workout_log: WorkoutLogRead | None
    merged_into_existing: bool = Field(
        default=False,
        description="True when the activity filled in a matching session already synced from "
        "Health Connect instead of creating a second one.",
    )


class CoachExerciseIn(BaseModel):
    exercise_name: str = Field(min_length=1, max_length=150)
    catalog_exercise_id: UUID | None = None
    exercise_kind: ExerciseKind = "strength"
    target_sets: int = Field(ge=1, le=20)
    target_reps_min: int = Field(ge=1, le=1000)
    target_reps_max: int | None = Field(
        default=None, ge=1, le=1000, description="Omitted: same as target_reps_min."
    )
    target_weight_kg: float | None = Field(
        default=None, ge=0, le=1000, description="Per dumbbell for dumbbell lifts."
    )
    target_rir: int | None = Field(default=None, ge=0, le=10)
    target_rpe: int | None = Field(default=None, ge=1, le=10)
    rest_time_seconds: int = Field(default=90, ge=0, le=3600)
    rationale: str | None = Field(
        default=None,
        max_length=240,
        description="Why this target, shown next to the exercise in the gym.",
    )
    group_key: str | None = Field(default=None, min_length=1, max_length=100)
    group_order: int | None = Field(default=None, ge=0)

    @field_validator("exercise_name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "exercise_name")

    @model_validator(mode="after")
    def targets_are_consistent(self) -> "CoachExerciseIn":
        if self.target_reps_max is None:
            self.target_reps_max = self.target_reps_min
        if self.target_reps_max < self.target_reps_min:
            raise ValueError("target_reps_max must be >= target_reps_min")
        if self.exercise_kind != "strength" and (
            self.target_rir is not None or self.target_rpe is not None
        ):
            raise ValueError("target_rir and target_rpe are only for strength exercises")
        return self


class AdaptiveWorkoutUpsert(BaseModel):
    scheduled_date: date
    name: str = Field(
        min_length=1,
        max_length=80,
        description="Session name; one coach session per date and name, rewritten on replay.",
    )
    notes: str | None = Field(default=None, max_length=2000)
    exercises: list[CoachExerciseIn] = Field(min_length=1, max_length=30)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")


class BaselineSession(BaseModel):
    date: date
    reps_per_set: list[int]
    weight_kg: float | None
    top_set_kg: float | None
    e1rm_kg: float | None = Field(description="Epley estimate from the best set.")


class ReadinessAdjustment(BaseModel):
    score: int
    load_factor: float
    reason: str
    logged_at: datetime


class ExerciseBaseline(BaseModel):
    exercise_name: str
    sessions: list[BaselineSession] = Field(description="Newest first, up to 5.")
    progression_weight_kg: float | None
    progression_reps: int
    progression_note: str | None
    readiness: ReadinessAdjustment | None
    suggested_weight_kg: float | None
    suggested_reps: int
    note: str | None


class AdaptiveWorkoutResult(BaseModel):
    created: bool
    scheduled_workout: ScheduledWorkoutRead
    plan: WorkoutPlanRead
    baselines: list[ExerciseBaseline] = Field(
        description="What history alone would suggest today, for comparison."
    )


class ContextWindow(BaseModel):
    start: date
    end: date
    days: int


class ContextProfile(BaseModel):
    display_name: str | None
    birth_year: int | None
    goals: list[str]
    dietary_constraints: list[DietaryConstraint]
    physical_constraints: list[str]


class ContextLocation(BaseModel):
    location: str
    kind: str
    equipment: list[str]


class ContextSession(BaseModel):
    date: date
    kind: str = Field(description="'strength' or the activity type.")
    name: str | None
    minutes: int
    rpe: int | None
    load_au: int | None = Field(description="Session RPE x minutes.")
    volume_kg: float
    laps: int | None
    sauna_rounds: int | None
    category: str = Field(default="strength", description="strength, cardio or recovery.")
    effort_level: int | None = Field(default=None, description="1 relaxed .. 5 max effort.")
    feel_before: int | None = None
    feel_after: int | None = None
    cycles: int | None = None


class ContextTotals(BaseModel):
    strength_sessions: int
    strength_volume_kg: float
    hockey_sessions: int
    swim_sessions: int
    load_au: int


class TrendPoint(BaseModel):
    date: date
    top_set: str = Field(description="e.g. '3x8 @ 70 kg'.")
    e1rm_kg: float | None


class ExerciseTrend(BaseModel):
    exercise: str
    sessions: list[TrendPoint]
    e1rm_change_kg: float | None = Field(description="Newest minus oldest e1RM in the list.")


class UpcomingItem(BaseModel):
    date: date
    kind: str = Field(description="'workout' or 'hockey_game' / 'hockey_practice'.")
    name: str
    status: str | None


class ContextTraining(BaseModel):
    sessions: list[ContextSession]
    totals: ContextTotals
    exercise_trends: list[ExerciseTrend]
    upcoming: list[UpcomingItem]


class RecoveryDeficits(BaseModel):
    sore_muscles: list[str] = Field(description="Reported at soreness >= 6 in the last 72 h.")
    avg_sleep_hours: float | None
    short_sleep_nights: int = Field(description="Nights under 7 h in the window.")


class ContextReadiness(BaseModel):
    latest: ReadinessLogRead | None
    today_score: int | None
    load_factor: float | None
    recent: list[ReadinessLogRead]
    deficits: RecoveryDeficits


class MacroTotals(BaseModel):
    energy_kcal: float
    protein_g: float
    fiber_g: float


class AdherenceDay(BaseModel):
    date: date
    eaten: MacroTotals
    target_energy_kcal: float | None
    target_protein_g: float | None
    energy_pct: int | None
    protein_pct: int | None


class ContextNutrition(BaseModel):
    plans: list[DayPlanRead]
    adherence: list[AdherenceDay]
    supplements: list[SupplementRead]


class CoachingContext(BaseModel):
    generated_at: datetime
    window: ContextWindow
    profile: ContextProfile
    coaching_principles: str
    equipment: list[ContextLocation]
    training: ContextTraining
    readiness: ContextReadiness
    nutrition: ContextNutrition
    rules: dict[str, str] = Field(description="How the app applies readiness and progression.")
