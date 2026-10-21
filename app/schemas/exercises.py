from datetime import datetime
from typing import Annotated, Literal, cast
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty
from app.services.equipment import normalize_any_of, parse_equipment_text
from app.services.volume import LoadMode

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

EquipmentTag = Literal[
    "bodyweight",
    "dumbbell",
    "kettlebell",
    "barbell",
    "trap_bar",
    "rack",
    "bench",
    "pullup_bar",
    "cable",
    "machine",
    "band",
    "trx",
    "dip_bars",
    "ab_wheel",
    "box",
    "medicine_ball",
    "jump_rope",
    "bike",
    "rower",
    "treadmill",
]
EquipmentOption = Annotated[list[EquipmentTag], Field(min_length=1, max_length=8)]

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
    # Alternatives, each a full set of tags. Left out, it is read from the
    # free-text `equipment`; an empty list means "not tagged".
    equipment_any_of: list[EquipmentOption] | None = Field(default=None, max_length=8)
    safety_notes: str | None = Field(default=None, max_length=4000)
    # The typed weight is always one dumbbell: "pair_db" counts it twice in
    # volume (both hands), "single_db" and "standard" once.
    equipment_load_mode: LoadMode = "standard"
    # One logged set is the same reps on each side; reps and volume count twice.
    is_unilateral: bool = False

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

    @model_validator(mode="after")
    def fill_equipment_tags(self) -> "ExerciseCreate":
        options = (
            parse_equipment_text(self.equipment)
            if self.equipment_any_of is None
            else normalize_any_of(self.equipment_any_of)
        )
        # Both helpers only return known tags, so the Literal type still holds.
        self.equipment_any_of = cast(list[list[EquipmentTag]], options)
        return self

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
    equipment_any_of: list[list[str]]
    safety_notes: str | None
    equipment_load_mode: LoadMode
    is_unilateral: bool
    created_at: datetime
    updated_at: datetime


class PaginatedExercisesResponse(PaginatedResponse[ExerciseRead]):
    pass
