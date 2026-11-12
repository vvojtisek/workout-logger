from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator


class TrainingLoadQuery(BaseModel):
    week_of: date = Field(description="Any local date in the last week to include.")
    weeks: int = Field(default=8, ge=1, le=26)
    timezone: str = Field(default="UTC", min_length=1, max_length=100)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError) as error:
            raise ValueError("timezone must be an IANA timezone name") from error
        return value

    @model_validator(mode="after")
    def validate_bounds(self) -> "TrainingLoadQuery":
        try:
            self.utc_bounds()
        except OverflowError as error:
            raise ValueError("week range exceeds the supported calendar") from error
        return self

    def first_week(self) -> date:
        return self.week_of - timedelta(days=self.week_of.weekday(), weeks=self.weeks - 1)

    def utc_bounds(self) -> tuple[datetime, datetime]:
        first = self.first_week()
        zone = ZoneInfo(self.timezone)
        return (
            datetime.combine(first, time.min, zone).astimezone(UTC),
            datetime.combine(first + timedelta(weeks=self.weeks), time.min, zone).astimezone(UTC),
        )


class MuscleVolume(BaseModel):
    muscle: str | None
    set_count: int
    volume_kg: float


class TrainingSessionEffort(BaseModel):
    logged_sessions: int = 0
    rated_sessions: int = 0
    rated_minutes: int = 0
    load_au: int | None = None


class SessionEffortDetail(BaseModel):
    performed_at_utc: datetime
    local_date: date
    activity_type: str | None
    duration_minutes: int
    effort_rpe: int | None
    load_au: int | None


class WeeklyWorkloadRatio(BaseModel):
    status: Literal[
        "ready", "week_incomplete", "missing_sessions", "missing_ratings", "zero_baseline"
    ] = "missing_sessions"
    baseline_start: date | None = None
    baseline_mean_au: float | None = None
    ratio: float | None = None


class SessionEffortByActivity(TrainingSessionEffort):
    activity_type: str | None
    workload_ratio: WeeklyWorkloadRatio = Field(default_factory=WeeklyWorkloadRatio)


class DailyTrainingLoad(BaseModel):
    local_date: date
    load_au: int


class WeeklyTrainingVariability(BaseModel):
    status: Literal["ready", "week_incomplete", "no_sessions", "missing_ratings", "zero_variation"]
    daily_mean_au: float | None = None
    daily_sd_au: float | None = None
    monotony: float | None = None
    strain_au: float | None = None
    daily_loads: list[DailyTrainingLoad] = Field(default_factory=list)


class TrainingLoadWeek(BaseModel):
    week_start: date
    gym_sessions: int = 0
    logged_sets: int = 0
    volume_kg: float = 0
    muscle_volume: list[MuscleVolume] = Field(default_factory=list)
    session_effort: TrainingSessionEffort = Field(default_factory=TrainingSessionEffort)
    session_effort_sessions: list[SessionEffortDetail] = Field(default_factory=list)
    session_effort_by_activity: list[SessionEffortByActivity] = Field(default_factory=list)
    workload_ratio: WeeklyWorkloadRatio = Field(default_factory=WeeklyWorkloadRatio)
    training_variability: WeeklyTrainingVariability = Field(
        default_factory=lambda: WeeklyTrainingVariability(status="no_sessions")
    )


class TrainingLoadResponse(BaseModel):
    timezone: str
    weeks: list[TrainingLoadWeek]
