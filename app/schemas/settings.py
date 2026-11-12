from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import OrmModel

Units = Literal["metric", "imperial"]


class PlateInventoryItem(BaseModel):
    plate_weight_kg: float = Field(gt=0, le=50, multiple_of=0.25)
    pairs: int = Field(ge=0, le=20)


class UserSettingsUpdate(BaseModel):
    units: Units = "metric"
    default_rest_compound_seconds: int = Field(default=90, ge=0, le=3600)
    default_rest_isolation_seconds: int = Field(default=60, ge=0, le=3600)
    barbell_weight_kg: float | None = Field(default=None, gt=0, le=100, multiple_of=0.25)
    plate_inventory: list[PlateInventoryItem] | None = None

    @model_validator(mode="after")
    def validate_plate_inventory(self) -> "UserSettingsUpdate":
        if self.plate_inventory is not None:
            weights = [plate.plate_weight_kg for plate in self.plate_inventory]
            if len(weights) != len(set(weights)):
                raise ValueError("plate weights must be unique")
        return self


class UserSettingsRead(OrmModel):
    id: UUID
    units: Units
    default_rest_compound_seconds: int
    default_rest_isolation_seconds: int
    barbell_weight_kg: float
    plate_inventory: list[PlateInventoryItem]
    created_at: datetime
    updated_at: datetime
