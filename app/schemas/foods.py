from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty


class FoodCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=150)
    serving_quantity: float = Field(gt=0, le=100_000)
    serving_unit: str = Field(min_length=1, max_length=30)
    energy_kcal: float = Field(ge=0, le=100_000)
    protein_g: float = Field(ge=0, le=10_000)
    carbohydrate_g: float = Field(ge=0, le=10_000)
    fat_g: float = Field(ge=0, le=10_000)
    fiber_g: float | None = Field(default=None, ge=0, le=10_000)
    source: str = Field(default="manual", max_length=30)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @field_validator("serving_unit")
    @classmethod
    def serving_unit_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "serving_unit")


class FoodReplace(FoodCreate):
    pass


class FoodRead(OrmModel):
    id: UUID
    name: str
    brand: str | None
    serving_quantity: float
    serving_unit: str
    energy_kcal: float
    protein_g: float
    carbohydrate_g: float
    fat_g: float
    fiber_g: float | None
    source: str
    created_at: datetime
    updated_at: datetime


class PaginatedFoodsResponse(PaginatedResponse[FoodRead]):
    pass
