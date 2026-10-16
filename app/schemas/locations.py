from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty
from app.schemas.exercises import EquipmentTag

LocationKind = Literal["home", "office", "gym", "travel"]


class LocationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: LocationKind
    # What the place has. Bodyweight is everywhere, so it is dropped.
    equipment: list[EquipmentTag] = Field(default_factory=list, max_length=40)
    default_minutes: int | None = Field(default=None, ge=5, le=240)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @field_validator("equipment")
    @classmethod
    def equipment_sorted_and_unique(cls, value: list[EquipmentTag]) -> list[EquipmentTag]:
        return sorted(set(value) - {"bodyweight"})


class LocationReplace(LocationCreate):
    pass


class LocationRead(OrmModel):
    id: UUID
    name: str
    kind: LocationKind
    equipment: list[str]
    default_minutes: int | None
    created_at: datetime
    updated_at: datetime


class PaginatedLocationsResponse(PaginatedResponse[LocationRead]):
    pass
