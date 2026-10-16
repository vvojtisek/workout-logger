from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty

LoadEventKind = Literal["game", "practice"]

# A season longer than a year is almost certainly a typo in the end date.
MAX_SEASON_DAYS = 366


class LoadEventCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: LoadEventKind
    weekday: int = Field(ge=0, le=6, description="Monday is 0, Sunday is 6.")
    start_time: time
    duration_minutes: int = Field(default=60, ge=15, le=300)
    season_start: date
    season_end: date

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @model_validator(mode="after")
    def season_is_valid(self) -> "LoadEventCreate":
        if self.season_end < self.season_start:
            raise ValueError("season_end must be on or after season_start")
        if (self.season_end - self.season_start).days > MAX_SEASON_DAYS:
            raise ValueError(f"a season cannot exceed {MAX_SEASON_DAYS} days")
        return self


class LoadEventReplace(LoadEventCreate):
    pass


class LoadEventRead(OrmModel):
    id: UUID
    name: str
    kind: LoadEventKind
    weekday: int
    start_time: time
    duration_minutes: int
    season_start: date
    season_end: date
    created_at: datetime
    updated_at: datetime


class PaginatedLoadEventsResponse(PaginatedResponse[LoadEventRead]):
    pass


class LoadEventOccurrence(BaseModel):
    """One dated instance of a recurring load event."""

    event_id: UUID
    date: date
    start_time: time
    duration_minutes: int
    kind: LoadEventKind
    name: str
