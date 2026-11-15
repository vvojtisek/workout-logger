from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.logs import ActivityType
from app.services.activity_kinds import Season

PrefillCategory = Literal["cardio", "recovery"]
PrefillBasis = Literal["same_weekday", "recent", "default"]


class ActivityTypeDefaults(BaseModel):
    activity_type: ActivityType
    activity_name: str | None = Field(description='Most common custom name for "other".')
    start_time: str | None = Field(
        description="Typical local start, HH:MM rounded to 15 minutes; null with no history."
    )
    started_at: datetime | None = Field(description="start_time on the requested date, in UTC.")
    duration_minutes: int
    effort_level: int | None = Field(description="1 relaxed .. 5 max effort.")
    cycles: int | None
    cycle_minutes: int | None
    observations: int = Field(description="Entries of this type in the history window.")
    same_weekday_observations: int
    basis: PrefillBasis = Field(
        description="same_weekday: from this weekday's entries; recent: from any day in the "
        "window; default: no history of this type."
    )


class RecoveryPreset(BaseModel):
    label: str
    activity_type: ActivityType
    duration_minutes: int
    cycles: int | None
    cycle_minutes: int | None
    times_logged: int = Field(description="How often this exact routine is in the window.")


class LinkCandidate(BaseModel):
    id: UUID
    activity_type: ActivityType | None
    name: str | None
    performed_at: datetime


class ActivityDefaultsResponse(BaseModel):
    date: date
    day_of_week: int = Field(description="0 Monday .. 6 Sunday.")
    season: Season = Field(description="winter = October to April, summer = May to September.")
    category: PrefillCategory
    timezone: str
    weeks: int
    history_entries: int = Field(description="Entries of this category in the window.")
    suggested: ActivityTypeDefaults
    ranked: list[ActivityTypeDefaults] = Field(
        description="Every type of the category, most likely first; the first is `suggested`."
    )
    time_slots: list[str] = Field(
        description="Frequent local start times (HH:MM) on this weekday, most frequent first."
    )
    presets: list[RecoveryPreset] = Field(
        default_factory=list, description="One-tap recovery routines, most frequent first."
    )
    link_candidates: list[LinkCandidate] = Field(
        default_factory=list,
        description="Training sessions on this date a recovery entry can be linked to.",
    )
