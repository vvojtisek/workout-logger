from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import OrmModel, require_non_empty


class QuickAddPresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    quantity: float = Field(gt=0, le=100_000)
    unit: str = Field(default="ml", min_length=1, max_length=30)
    energy_kcal: float = Field(ge=0, le=100_000)
    protein_g: float = Field(default=0, ge=0, le=10_000)
    carbohydrate_g: float = Field(default=0, ge=0, le=10_000)
    fat_g: float = Field(default=0, ge=0, le=10_000)
    fiber_g: float | None = Field(default=None, ge=0, le=10_000)
    position: int = Field(default=0, ge=0, le=1000)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @field_validator("unit")
    @classmethod
    def unit_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "unit")


class QuickAddPresetReplace(QuickAddPresetCreate):
    pass


class QuickAddPresetRead(OrmModel):
    id: UUID
    name: str
    quantity: float
    unit: str
    energy_kcal: float
    protein_g: float
    carbohydrate_g: float
    fat_g: float
    fiber_g: float | None
    position: int
    created_at: datetime
    updated_at: datetime


class QuickAddPresetList(BaseModel):
    items: list[QuickAddPresetRead]
