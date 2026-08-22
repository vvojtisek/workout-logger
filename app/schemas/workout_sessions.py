from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import OrmModel


class WorkoutSessionStart(BaseModel):
    source_plan_id: UUID


class SetEntryCreate(BaseModel):
    session_exercise_id: UUID
    set_number: int = Field(ge=1, le=100)
    weight_kg: float | None = Field(default=None, ge=0)
    reps: int = Field(ge=1, le=1000)
    rir: int | None = Field(default=None, ge=0, le=10)
    state: Literal["completed", "skipped"] = "completed"
    client_operation_id: str = Field(min_length=1, max_length=100)


class SetEntryUpdate(BaseModel):
    weight_kg: float | None = Field(default=None, ge=0)
    reps: int = Field(ge=1, le=1000)
    rir: int | None = Field(default=None, ge=0, le=10)


class WorkoutSessionFocus(BaseModel):
    session_exercise_id: UUID
    set_number: int = Field(ge=1, le=100)


class WorkoutSessionRestUpdate(BaseModel):
    adjustment_seconds: int | None = Field(default=None, ge=-3600, le=3600)
    skip: bool = False
    expected_version: int = Field(ge=1)

    @model_validator(mode="after")
    def one_rest_action_is_required(self) -> "WorkoutSessionRestUpdate":
        has_adjustment = self.adjustment_seconds is not None
        if has_adjustment == self.skip or self.adjustment_seconds == 0:
            raise ValueError("provide one non-zero adjustment or skip")
        return self


class WorkoutSessionComplete(BaseModel):
    overall_feeling: int = Field(ge=1, le=5)


class SetEntryRead(OrmModel):
    id: UUID
    set_number: int
    weight_kg: float | None
    reps: int
    rir: int | None
    state: str
    completed_at: datetime
    client_operation_id: str


class SessionExerciseRead(OrmModel):
    id: UUID
    sort_order: int
    exercise_name: str
    target_sets: int
    target_reps_min: int
    target_reps_max: int
    target_weight_kg: float | None
    rest_time_seconds: int
    notes: str | None
    group_key: str | None
    group_order: int | None
    suggested_weight_kg: float | None
    suggested_reps: int
    suggestion_source: str
    status: str
    set_entries: list[SetEntryRead]


class WorkoutSessionRead(OrmModel):
    id: UUID
    source_plan_id: UUID | None
    source_plan_name: str
    workout_log_id: UUID | None
    status: str
    started_at: datetime
    completed_at: datetime | None
    focused_exercise_id: UUID | None
    focused_set_number: int
    rest_ends_at: datetime | None
    version: int
    exercises: list[SessionExerciseRead]
