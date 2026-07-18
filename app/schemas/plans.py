from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty


class PlanExerciseCreate(BaseModel):
    exercise_name: str = Field(min_length=1, max_length=150)
    target_sets: int = Field(ge=1, le=100)
    target_reps_min: int = Field(ge=1, le=1000)
    target_reps_max: int = Field(ge=1, le=1000)
    target_weight_kg: float | None = Field(default=None, ge=0)
    rest_time_seconds: int = Field(default=60, ge=0, le=3600)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("exercise_name")
    @classmethod
    def exercise_name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "exercise_name")

    @model_validator(mode="after")
    def reps_range_is_valid(self) -> "PlanExerciseCreate":
        if self.target_reps_max < self.target_reps_min:
            raise ValueError("target_reps_max must be >= target_reps_min")
        return self


class PlanExerciseRead(PlanExerciseCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sort_order: int


class WorkoutPlanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    exercises: list[PlanExerciseCreate] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")


class WorkoutPlanReplace(WorkoutPlanCreate):
    pass


class WorkoutPlanRead(OrmModel):
    id: UUID
    name: str
    description: str | None
    exercises: list[PlanExerciseRead]
    created_at: datetime
    updated_at: datetime


class PaginatedPlansResponse(PaginatedResponse[WorkoutPlanRead]):
    pass
