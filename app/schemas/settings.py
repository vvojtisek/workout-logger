from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import OrmModel, require_non_empty

Units = Literal["metric", "imperial"]


class PlateInventoryItem(BaseModel):
    plate_weight_kg: float = Field(gt=0, le=50, multiple_of=0.25)
    pairs: int = Field(ge=0, le=20)


class EquipmentProfile(BaseModel):
    id: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")]
    name: Annotated[str, Field(min_length=1, max_length=60)]
    barbell_weight_kg: float = Field(gt=0, le=100, multiple_of=0.25)
    plate_inventory: list[PlateInventoryItem]

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "profile name")

    @model_validator(mode="after")
    def validate_plate_inventory(self) -> "EquipmentProfile":
        weights = [plate.plate_weight_kg for plate in self.plate_inventory]
        if len(weights) != len(set(weights)):
            raise ValueError("plate weights must be unique within a profile")
        return self


class UserSettingsUpdate(BaseModel):
    units: Units = "metric"
    default_rest_compound_seconds: int = Field(default=90, ge=0, le=3600)
    default_rest_isolation_seconds: int = Field(default=60, ge=0, le=3600)
    barbell_weight_kg: float | None = Field(default=None, gt=0, le=100, multiple_of=0.25)
    plate_inventory: list[PlateInventoryItem] | None = None
    equipment_profiles: list[EquipmentProfile] | None = Field(
        default=None, min_length=1, max_length=12
    )
    active_equipment_profile_id: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def validate_plate_inventory(self) -> "UserSettingsUpdate":
        if self.plate_inventory is not None:
            weights = [plate.plate_weight_kg for plate in self.plate_inventory]
            if len(weights) != len(set(weights)):
                raise ValueError("plate weights must be unique")
        if self.equipment_profiles is not None:
            profile_ids = [profile.id for profile in self.equipment_profiles]
            profile_names = [profile.name.strip().casefold() for profile in self.equipment_profiles]
            if len(profile_ids) != len(set(profile_ids)):
                raise ValueError("equipment profile IDs must be unique")
            if len(profile_names) != len(set(profile_names)):
                raise ValueError("equipment profile names must be unique")
            if self.active_equipment_profile_id is not None and (
                self.active_equipment_profile_id not in profile_ids
            ):
                raise ValueError("active equipment profile must exist in equipment_profiles")
        elif self.active_equipment_profile_id is not None:
            raise ValueError("equipment_profiles are required when selecting an active profile")
        return self


class UserSettingsRead(OrmModel):
    id: UUID
    units: Units
    default_rest_compound_seconds: int
    default_rest_isolation_seconds: int
    barbell_weight_kg: float
    plate_inventory: list[PlateInventoryItem]
    equipment_profiles: list[EquipmentProfile]
    active_equipment_profile_id: str
    created_at: datetime
    updated_at: datetime
