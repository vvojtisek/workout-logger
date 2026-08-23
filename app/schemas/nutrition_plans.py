from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty


class NutritionPlanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    valid_from: date
    valid_to: date | None = None
    energy_target_kcal: float = Field(gt=0, le=100_000)
    protein_target_g: float = Field(ge=0, le=10_000)
    carbohydrate_target_g: float = Field(ge=0, le=10_000)
    fat_target_g: float = Field(ge=0, le=10_000)
    fiber_target_g: float | None = Field(default=None, ge=0, le=10_000)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @model_validator(mode="after")
    def date_range_is_valid(self) -> "NutritionPlanCreate":
        if self.valid_to is not None and self.valid_to < self.valid_from:
            raise ValueError("valid_to must be on or after valid_from")
        return self


class NutritionPlanReplace(NutritionPlanCreate):
    pass


class NutritionPlanRead(OrmModel):
    id: UUID
    name: str
    valid_from: date
    valid_to: date | None
    energy_target_kcal: float
    protein_target_g: float
    carbohydrate_target_g: float
    fat_target_g: float
    fiber_target_g: float | None
    created_at: datetime
    updated_at: datetime


class PaginatedNutritionPlansResponse(PaginatedResponse[NutritionPlanRead]):
    pass
