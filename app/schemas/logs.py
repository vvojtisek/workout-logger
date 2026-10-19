from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.common import (
    OrmModel,
    PaginatedResponse,
    require_non_empty,
    require_timezone_aware_utc,
)


class ExerciseLogCreate(BaseModel):
    exercise_name: str = Field(min_length=1, max_length=150)
    sets_count: int = Field(ge=1, le=100)
    reps_per_set: list[int]
    weight_kg: float | None = Field(default=None, ge=0)
    weight_per_set: list[Annotated[float, Field(ge=0)] | None] | None = Field(
        default=None,
        description="Weight of each set in kg, one entry per set. When sent, weight_kg "
        "is set to the last non-null entry.",
    )
    rir_per_set: list[Annotated[int, Field(ge=0, le=10)] | None] | None = Field(
        default=None, description="Reps in reserve for each set, one entry per set."
    )
    rest_time_seconds: int = Field(default=60, ge=0, le=3600)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("exercise_name")
    @classmethod
    def exercise_name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "exercise_name")

    @field_validator("reps_per_set")
    @classmethod
    def reps_per_set_not_empty_and_positive(cls, value: list[int]) -> list[int]:
        if not value:
            raise ValueError("reps_per_set must not be empty")
        if any(reps <= 0 for reps in value):
            raise ValueError("all values in reps_per_set must be greater than zero")
        return value

    @model_validator(mode="after")
    def sets_count_matches_reps_per_set(self) -> "ExerciseLogCreate":
        if len(self.reps_per_set) != self.sets_count:
            raise ValueError("sets_count must equal the number of entries in reps_per_set")
        for name in ("weight_per_set", "rir_per_set"):
            values = getattr(self, name)
            if values is not None and len(values) != self.sets_count:
                raise ValueError(f"{name} must have one entry per set")
        return self

    @model_validator(mode="after")
    def working_weight_is_the_last_set_s(self) -> "ExerciseLogCreate":
        # Progression and stats read weight_kg; a finished live session stores
        # its last set's weight there, so an edited log does the same.
        if self.weight_per_set is not None:
            loaded = [weight for weight in self.weight_per_set if weight is not None]
            self.weight_kg = loaded[-1] if loaded else None
        return self


class ExerciseLogRead(ExerciseLogCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sort_order: int


ActivityType = Literal["ice_hockey", "swimming", "cycling", "hiking", "running", "other"]


class WorkoutLogCreate(BaseModel):
    source_plan_id: UUID | None = None
    performed_at: datetime
    total_time_minutes: int = Field(ge=1, le=1440)
    calories_burned: int | None = Field(default=None, ge=0)
    overall_feeling: int = Field(ge=1, le=5)
    notes: str | None = Field(default=None, max_length=10000)
    activity_type: ActivityType | None = None
    distance_km: float | None = Field(default=None, ge=0, le=1000)
    effort_rpe: int | None = Field(default=None, ge=1, le=10)
    exercises: list[ExerciseLogCreate] = Field(default_factory=list)

    @field_validator("performed_at")
    @classmethod
    def performed_at_requires_timezone(cls, value: datetime) -> datetime:
        return require_timezone_aware_utc(value)


class WorkoutLogReplace(WorkoutLogCreate):
    pass


class WorkoutLogPatch(BaseModel):
    """Fields to change on a stored log. Omitted fields keep their value; an
    explicit null clears an optional one. `exercises` replaces the whole list."""

    model_config = ConfigDict(extra="forbid")

    source_plan_id: UUID | None = None
    performed_at: datetime | None = None
    total_time_minutes: int | None = None
    calories_burned: int | None = None
    overall_feeling: int | None = None
    notes: str | None = None
    activity_type: ActivityType | None = None
    distance_km: float | None = None
    effort_rpe: int | None = None
    exercises: list[ExerciseLogCreate] | None = None


class WorkoutLogRead(OrmModel):
    id: UUID
    source_plan_id: UUID | None
    source_plan_name: str | None
    performed_at: datetime
    total_time_minutes: int
    calories_burned: int | None
    overall_feeling: int
    notes: str | None
    source: str
    external_id: str | None
    activity_type: ActivityType | None
    distance_km: float | None
    effort_rpe: int | None
    exercises: list[ExerciseLogRead]
    created_at: datetime
    updated_at: datetime


class PaginatedLogsResponse(PaginatedResponse[WorkoutLogRead]):
    pass
