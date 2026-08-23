from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import (
    OrmModel,
    PaginatedResponse,
    require_non_empty,
    require_timezone_aware_utc,
)


class SleepEntryCreate(BaseModel):
    sleep_start: datetime
    sleep_end: datetime
    # An IANA zone name (e.g. "America/New_York"), used to attribute this
    # entry to the calendar day the sleeper woke up on.
    timezone: str = Field(min_length=1, max_length=50)
    estimated_sleep_seconds: int | None = Field(default=None, ge=0, le=86_400)
    awake_seconds: int | None = Field(default=None, ge=0, le=86_400)
    quality_score: int | None = Field(default=None, ge=1, le=5)
    resting_heart_rate: int | None = Field(default=None, ge=20, le=250)
    notes: str | None = Field(default=None, max_length=2000)
    source: str = Field(default="manual", max_length=30)

    @field_validator("sleep_start", "sleep_end")
    @classmethod
    def requires_timezone(cls, value: datetime) -> datetime:
        return require_timezone_aware_utc(value)

    @field_validator("timezone")
    @classmethod
    def timezone_is_valid_iana_name(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"'{value}' is not a recognized IANA timezone name") from exc
        return value

    @field_validator("notes")
    @classmethod
    def notes_not_blank(cls, value: str | None) -> str | None:
        return require_non_empty(value, "notes") if value is not None else None

    @model_validator(mode="after")
    def sleep_end_after_start(self) -> "SleepEntryCreate":
        if self.sleep_end <= self.sleep_start:
            raise ValueError("sleep_end must be after sleep_start")
        return self


class SleepEntryReplace(SleepEntryCreate):
    pass


class SleepEntryRead(OrmModel):
    id: UUID
    sleep_start: datetime
    sleep_end: datetime
    timezone: str
    sleep_date: date
    time_in_bed_seconds: int
    estimated_sleep_seconds: int | None
    awake_seconds: int | None
    quality_score: int | None
    resting_heart_rate: int | None
    notes: str | None
    source: str
    created_at: datetime
    updated_at: datetime


class PaginatedSleepEntriesResponse(PaginatedResponse[SleepEntryRead]):
    pass


class SleepTrends(BaseModel):
    latest: SleepEntryRead | None
    average_sleep_seconds_7d: float | None
    average_sleep_seconds_30d: float | None
    average_quality_score_7d: float | None
    average_quality_score_30d: float | None
