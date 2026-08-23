from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import (
    OrmModel,
    PaginatedResponse,
    require_non_empty,
    require_timezone_aware_utc,
)

MealType = Literal["breakfast", "lunch", "dinner", "snack"]

_AD_HOC_REQUIRED_FIELDS = (
    "food_name_snapshot",
    "unit",
    "energy_kcal",
    "protein_g",
    "carbohydrate_g",
    "fat_g",
)


class MealItemCreate(BaseModel):
    # Set food_id to snapshot nutrition from the catalogue, scaled by
    # quantity/food.serving_quantity. Leave it unset to log an ad hoc item
    # with the nutrition values supplied directly.
    food_id: UUID | None = None
    quantity: float = Field(gt=0, le=100_000)
    unit: str | None = Field(default=None, max_length=30)
    food_name_snapshot: str | None = Field(default=None, max_length=200)
    energy_kcal: float | None = Field(default=None, ge=0, le=100_000)
    protein_g: float | None = Field(default=None, ge=0, le=10_000)
    carbohydrate_g: float | None = Field(default=None, ge=0, le=10_000)
    fat_g: float | None = Field(default=None, ge=0, le=10_000)
    fiber_g: float | None = Field(default=None, ge=0, le=10_000)

    @model_validator(mode="after")
    def ad_hoc_requires_full_nutrition(self) -> "MealItemCreate":
        if self.food_id is None:
            missing = [field for field in _AD_HOC_REQUIRED_FIELDS if getattr(self, field) is None]
            if missing:
                raise ValueError(
                    "When food_id is not set, these fields are required: " + ", ".join(missing)
                )
        return self


class MealEntryCreate(BaseModel):
    consumed_at: datetime
    meal_type: MealType
    notes: str | None = Field(default=None, max_length=2000)
    items: list[MealItemCreate] = Field(min_length=1)

    @field_validator("consumed_at")
    @classmethod
    def consumed_at_requires_timezone(cls, value: datetime) -> datetime:
        return require_timezone_aware_utc(value)

    @field_validator("notes")
    @classmethod
    def notes_not_blank(cls, value: str | None) -> str | None:
        return require_non_empty(value, "notes") if value is not None else None


class MealEntryReplace(MealEntryCreate):
    pass


class MealItemRead(OrmModel):
    id: UUID
    food_id: UUID | None
    food_name_snapshot: str
    quantity: float
    unit: str
    energy_kcal_snapshot: float
    protein_g_snapshot: float
    carbohydrate_g_snapshot: float
    fat_g_snapshot: float
    fiber_g_snapshot: float | None


class MealEntryRead(OrmModel):
    id: UUID
    consumed_at: datetime
    meal_type: MealType
    notes: str | None
    items: list[MealItemRead]
    created_at: datetime
    updated_at: datetime


class PaginatedMealEntriesResponse(PaginatedResponse[MealEntryRead]):
    pass
