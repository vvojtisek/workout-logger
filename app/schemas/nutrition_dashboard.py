from datetime import date
from uuid import UUID

from pydantic import BaseModel


class NutritionTotals(BaseModel):
    energy_kcal: float
    protein_g: float
    carbohydrate_g: float
    fat_g: float
    fiber_g: float


class NutritionTarget(BaseModel):
    nutrition_plan_id: UUID
    name: str
    energy_target_kcal: float
    protein_target_g: float
    carbohydrate_target_g: float
    fat_target_g: float
    fiber_target_g: float | None


class NutritionRemaining(BaseModel):
    energy_kcal: float
    protein_g: float
    carbohydrate_g: float
    fat_g: float
    fiber_g: float | None


class NutritionDailySummary(BaseModel):
    date: date
    totals: NutritionTotals
    target: NutritionTarget | None
    remaining: NutritionRemaining | None
