from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import OrmModel, PaginatedResponse

ScheduledWorkoutStatus = Literal["scheduled", "in_progress", "completed", "skipped"]
# A user may only move a workout between these two states directly; "in_progress"
# and "completed" are set by the server when a session is started or finished.
ScheduledWorkoutUserStatus = Literal["scheduled", "skipped"]


class ScheduledWorkoutCreate(BaseModel):
    program_id: UUID | None = None
    workout_plan_id: UUID
    scheduled_date: date


class ScheduledWorkoutUpdate(BaseModel):
    program_id: UUID | None = Field(default=None)
    scheduled_date: date | None = Field(default=None)
    status: ScheduledWorkoutUserStatus | None = Field(default=None)


class ScheduledWorkoutRead(OrmModel):
    id: UUID
    program_id: UUID | None
    program_name: str | None
    workout_plan_id: UUID
    workout_plan_name: str
    scheduled_date: date
    status: ScheduledWorkoutStatus
    workout_session_id: UUID | None
    created_at: datetime
    updated_at: datetime


class PaginatedScheduledWorkoutsResponse(PaginatedResponse[ScheduledWorkoutRead]):
    pass
