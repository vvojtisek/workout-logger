from datetime import UTC, date, datetime, time, timedelta
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


class TrainingLoadWeek(BaseModel):
    week_start: date
    gym_sessions: int = 0
    logged_sets: int = 0
    volume_kg: float = 0


class TrainingLoadResponse(BaseModel):
    timezone: str
    weeks: list[TrainingLoadWeek]
