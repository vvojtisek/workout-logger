from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty

MuscleTag = Literal[
    "chest",
    "back",
    "shoulders",
    "biceps",
    "triceps",
    "forearms",
    "quads",
    "hamstrings",
    "glutes",
    "calves",
    "core",
    "full_body",
]

Alias = Annotated[str, Field(min_length=1, max_length=150)]
InstructionStep = Annotated[str, Field(min_length=1, max_length=1000)]


class ExerciseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    aliases: list[Alias] = Field(default_factory=list)
    # A validated HTTPS URL only; the client decides how to render it (a
    # self-hosted /data file plays inline, anything else is a link-out card).
    media_url: str | None = Field(default=None, max_length=2000)
    primary_muscles: list[MuscleTag] = Field(default_factory=list)
    secondary_muscles: list[MuscleTag] = Field(default_factory=list)
    instructions: list[InstructionStep] = Field(default_factory=list)
    equipment: str | None = Field(default=None, max_length=200)
    safety_notes: str | None = Field(default=None, max_length=4000)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @field_validator("aliases")
    @classmethod
    def aliases_not_blank(cls, value: list[str]) -> list[str]:
        return [require_non_empty(alias, "alias") for alias in value]

    @field_validator("instructions")
    @classmethod
    def instructions_not_blank(cls, value: list[str]) -> list[str]:
        return [require_non_empty(step, "instruction step") for step in value]

    @field_validator("media_url")
    @classmethod
    def media_url_is_https(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("media_url must be an https:// URL")
        return value


class ExerciseReplace(ExerciseCreate):
    pass


class ExerciseRead(OrmModel):
    id: UUID
    name: str
    aliases: list[str]
    media_url: str | None
    primary_muscles: list[str]
    secondary_muscles: list[str]
    instructions: list[str]
    equipment: str | None
    safety_notes: str | None
    created_at: datetime
    updated_at: datetime


class PaginatedExercisesResponse(PaginatedResponse[ExerciseRead]):
    pass
