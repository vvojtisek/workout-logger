from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty
from app.schemas.exercises import EquipmentTag

LocationKind = Literal["home", "office", "gym", "travel"]


def _require_gram_precision(value: object, field: str) -> object:
    try:
        decimal_value = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"{field} must use at most three decimal places") from exc
    exponent = decimal_value.as_tuple().exponent
    if not decimal_value.is_finite() or not isinstance(exponent, int) or exponent < -3:
        raise ValueError(f"{field} must use at most three decimal places")
    return value


class PlateStock(BaseModel):
    weight_kg: float = Field(gt=0, le=100)
    pairs: int = Field(ge=1, le=30)

    @field_validator("weight_kg", mode="before")
    @classmethod
    def weight_has_gram_precision(cls, value: object) -> object:
        return _require_gram_precision(value, "Plate weights")


class PlateProfile(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    bar_kg: float = Field(gt=0, le=100)
    collars_kg: float = Field(ge=0, le=10)
    plates: list[PlateStock] = Field(min_length=1, max_length=20)

    @field_validator("name")
    @classmethod
    def profile_name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "profile name")

    @field_validator("bar_kg", "collars_kg", mode="before")
    @classmethod
    def fixed_weight_has_gram_precision(cls, value: object) -> object:
        return _require_gram_precision(value, "Bar and collar weights")

    @field_validator("plates")
    @classmethod
    def plate_weights_unique(cls, value: list[PlateStock]) -> list[PlateStock]:
        weights = [item.weight_kg for item in value]
        if len(set(weights)) != len(weights):
            raise ValueError("Each plate weight can only appear once")
        return sorted(value, key=lambda item: item.weight_kg, reverse=True)


class LocationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: LocationKind
    # What the place has. Bodyweight is everywhere, so it is dropped.
    equipment: list[EquipmentTag] = Field(default_factory=list, max_length=40)
    default_minutes: int | None = Field(default=None, ge=5, le=240)
    plate_profiles: list[PlateProfile] = Field(default_factory=list, max_length=8)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @field_validator("equipment")
    @classmethod
    def equipment_sorted_and_unique(cls, value: list[EquipmentTag]) -> list[EquipmentTag]:
        return sorted(set(value) - {"bodyweight"})

    @field_validator("plate_profiles")
    @classmethod
    def profile_names_unique(cls, value: list[PlateProfile]) -> list[PlateProfile]:
        names = [item.name.strip().casefold() for item in value]
        if any(not name for name in names) or len(set(names)) != len(names):
            raise ValueError("Plate profile names must be unique")
        for profile in value:
            profile.name = profile.name.strip()
        return value


class LocationReplace(LocationCreate):
    pass


class LocationRead(OrmModel):
    id: UUID
    name: str
    kind: LocationKind
    equipment: list[str]
    default_minutes: int | None
    plate_profiles: list[PlateProfile]
    created_at: datetime
    updated_at: datetime


class PaginatedLocationsResponse(PaginatedResponse[LocationRead]):
    pass
