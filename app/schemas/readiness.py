from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import OrmModel, require_timezone_aware_utc
from app.schemas.exercises import MuscleTag

PriorDayStrain = Literal["none", "moderate", "high"]


class ReadinessLogCreate(BaseModel):
    log_date: date | None = Field(
        default=None, description="The athlete's local date. Omitted: today (UTC)."
    )
    logged_at: datetime | None = None
    soreness: int | None = Field(default=None, ge=1, le=10, description="1 none, 10 very sore.")
    sore_muscle_groups: list[MuscleTag] = Field(default_factory=list, max_length=12)
    fatigue: int | None = Field(default=None, ge=1, le=10, description="1 fresh, 10 exhausted.")
    sleep_quality: int | None = Field(
        default=None, ge=1, le=10, description="1 very poor, 10 excellent."
    )
    prior_day_strain: PriorDayStrain | None = Field(
        default=None,
        description="Omitted: derived from yesterday's logged sessions (hockey = high).",
    )
    physical_constraints: list[str] = Field(
        default_factory=list,
        max_length=8,
        description="Today's limits, e.g. 'left knee: no deep flexion'.",
    )
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("logged_at")
    @classmethod
    def logged_at_requires_timezone(cls, value: datetime | None) -> datetime | None:
        return None if value is None else require_timezone_aware_utc(value)

    @field_validator("physical_constraints")
    @classmethod
    def clean_constraints(cls, value: list[str]) -> list[str]:
        lines = [line.strip() for line in value if line.strip()]
        if any(len(line) > 200 for line in lines):
            raise ValueError("each constraint must be at most 200 characters")
        return lines

    @model_validator(mode="after")
    def has_a_metric(self) -> "ReadinessLogCreate":
        if self.soreness is None and self.fatigue is None and self.sleep_quality is None:
            raise ValueError("give at least one of soreness, fatigue or sleep_quality")
        return self


class ReadinessLogRead(OrmModel):
    id: UUID
    log_date: date
    logged_at: datetime
    soreness: int | None
    sore_muscle_groups: list[str]
    fatigue: int | None
    sleep_quality: int | None
    prior_day_strain: PriorDayStrain
    strain_source: Literal["manual", "derived"]
    physical_constraints: list[str]
    notes: str | None
    source: Literal["app", "mcp", "api"]
    score: int = Field(description="0-100, higher = more recovered.")
    load_factor: float = Field(description="Multiplier on history-based loads, 0.85-1.00.")
    created_at: datetime


class ReadinessLogList(BaseModel):
    items: list[ReadinessLogRead]
