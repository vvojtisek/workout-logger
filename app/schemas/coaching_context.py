from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import OrmModel

MAX_PROFILE_BYTES = 8_192
MAX_NOTES_BYTES = 4_096

CoachingContextTarget = Literal["profile", "notes"]


def _validate_utf8_byte_limit(value: str | None, *, max_bytes: int, field_name: str) -> str | None:
    if value is not None and len(value.encode("utf-8")) > max_bytes:
        raise ValueError(f"{field_name} must be at most {max_bytes} UTF-8 bytes")
    return value


class CoachingContextRead(OrmModel):
    athlete_profile_md: str | None
    profile_version: int
    has_previous_profile: bool
    working_notes_md: str | None
    notes_version: int
    has_previous_notes: bool
    updated_at: datetime


class CoachingContextProfileUpdate(BaseModel):
    athlete_profile_md: str | None = None
    expected_profile_version: int = Field(ge=1)

    @field_validator("athlete_profile_md")
    @classmethod
    def check_profile_bytes(cls, value: str | None) -> str | None:
        return _validate_utf8_byte_limit(
            value, max_bytes=MAX_PROFILE_BYTES, field_name="athlete_profile_md"
        )


class CoachingContextNotesUpdate(BaseModel):
    working_notes_md: str | None = None
    expected_notes_version: int = Field(ge=1)

    @field_validator("working_notes_md")
    @classmethod
    def check_notes_bytes(cls, value: str | None) -> str | None:
        return _validate_utf8_byte_limit(
            value, max_bytes=MAX_NOTES_BYTES, field_name="working_notes_md"
        )


class CoachingContextRevertRequest(BaseModel):
    target: CoachingContextTarget
