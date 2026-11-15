from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import OrmModel, require_non_empty
from app.schemas.meal_entries import MealType

SupplementTiming = Literal[
    "morning", "pre_workout", "post_workout", "with_meal", "evening", "bedtime"
]
SupplementDays = Literal["daily", "training_days", "rest_days", "hockey_days"]


class PlannedIngredientIn(BaseModel):
    name: str = Field(min_length=1, max_length=150, description="e.g. 'chicken breast'.")
    quantity: float = Field(gt=0, le=100_000)
    unit: str = Field(
        min_length=1, max_length=20, description="g, ml, pcs, tbsp, tsp... Lower-cased."
    )
    note: str | None = Field(default=None, max_length=200, description="e.g. 'raw weight'.")
    food_id: UUID | None = None
    energy_kcal: float | None = Field(default=None, ge=0, le=20_000)
    protein_g: float | None = Field(default=None, ge=0, le=2_000)
    carbohydrate_g: float | None = Field(default=None, ge=0, le=2_000)
    fat_g: float | None = Field(default=None, ge=0, le=2_000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @field_validator("unit")
    @classmethod
    def unit_lower(cls, value: str) -> str:
        return require_non_empty(value, "unit").lower()


class PlannedMealIn(BaseModel):
    meal_type: MealType
    name: str = Field(min_length=1, max_length=150)
    prep_steps: list[str] = Field(default_factory=list, max_length=20)
    energy_kcal: float = Field(ge=0, le=20_000)
    protein_g: float = Field(ge=0, le=2_000)
    carbohydrate_g: float = Field(ge=0, le=2_000)
    fat_g: float = Field(ge=0, le=2_000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)
    ingredients: list[PlannedIngredientIn] = Field(min_length=1, max_length=40)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @field_validator("prep_steps")
    @classmethod
    def clean_steps(cls, value: list[str]) -> list[str]:
        steps = [step.strip() for step in value if step.strip()]
        if any(len(step) > 500 for step in steps):
            raise ValueError("each prep step must be at most 500 characters")
        return steps


class DayPlanIn(BaseModel):
    plan_date: date
    energy_target_kcal: float = Field(ge=0, le=20_000)
    protein_target_g: float = Field(ge=0, le=2_000)
    fiber_target_g: float | None = Field(default=None, ge=0, le=500)
    carbohydrate_target_g: float | None = Field(default=None, ge=0, le=2_000)
    fat_target_g: float | None = Field(default=None, ge=0, le=2_000)
    notes: str | None = Field(default=None, max_length=2000)
    meals: list[PlannedMealIn] = Field(min_length=1, max_length=8)


class SupplementIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    dose: float = Field(gt=0, le=100_000)
    unit: str = Field(min_length=1, max_length=20, description="g, mg, ug, IU, caps...")
    timing: SupplementTiming
    applies_on: SupplementDays = "daily"
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("name", "unit")
    @classmethod
    def not_blank(cls, value: str) -> str:
        return require_non_empty(value)


class NutritionPlanUpsert(BaseModel):
    days: list[DayPlanIn] = Field(min_length=1, max_length=7)
    supplement_stack: list[SupplementIn] | None = Field(
        default=None,
        max_length=20,
        description=(
            "The full active supplement protocol. Omitted: unchanged. Empty list: no "
            "supplements. Entries not listed become inactive; intake history is kept."
        ),
    )

    @model_validator(mode="after")
    def unique_dates_and_supplements(self) -> "NutritionPlanUpsert":
        dates = [day.plan_date for day in self.days]
        if len(set(dates)) != len(dates):
            raise ValueError("each plan_date may appear only once")
        if self.supplement_stack is not None:
            keys = [(item.name.lower(), item.timing) for item in self.supplement_stack]
            if len(set(keys)) != len(keys):
                raise ValueError("each supplement name and timing may appear only once")
        return self


class PlannedIngredientRead(OrmModel):
    id: UUID
    name: str
    quantity: float
    unit: str
    note: str | None
    food_id: UUID | None
    energy_kcal: float | None
    protein_g: float | None
    carbohydrate_g: float | None
    fat_g: float | None
    fiber_g: float | None
    prepared: bool


class PlannedMealRead(OrmModel):
    id: UUID
    sort_order: int
    meal_type: MealType
    name: str
    prep_steps: list[str]
    energy_kcal: float
    protein_g: float
    carbohydrate_g: float
    fat_g: float
    fiber_g: float | None
    eaten_meal_entry_id: UUID | None
    ingredients: list[PlannedIngredientRead]


class GroceryItemRead(OrmModel):
    id: UUID
    name: str
    unit: str
    quantity: float
    checked: bool


class DayPlanRead(OrmModel):
    id: UUID
    plan_date: date
    energy_target_kcal: float
    protein_target_g: float
    fiber_target_g: float | None
    carbohydrate_target_g: float | None
    fat_target_g: float | None
    notes: str | None
    source: Literal["coach", "manual"]
    meals: list[PlannedMealRead]
    grocery_items: list[GroceryItemRead]
    updated_at: datetime


class DayPlanList(BaseModel):
    items: list[DayPlanRead]


class SupplementRead(OrmModel):
    id: UUID
    name: str
    dose: float
    unit: str
    timing: SupplementTiming
    applies_on: SupplementDays
    notes: str | None
    active: bool


class SupplementList(BaseModel):
    items: list[SupplementRead]


class NutritionPlanUpsertResult(BaseModel):
    days: list[DayPlanRead]
    supplements: list[SupplementRead]


class GroceryLine(BaseModel):
    name: str
    unit: str
    quantity: float
    checked: bool = Field(description="True when every underlying day item is checked.")
    item_ids: list[UUID]
    dates: list[date]


class GroceryList(BaseModel):
    start: date
    end: date
    items: list[GroceryLine]


class GroceryCheck(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=200)
    checked: bool


class IngredientPatch(BaseModel):
    prepared: bool


class SupplementDue(BaseModel):
    supplement: SupplementRead
    taken: bool
    taken_at: datetime | None


class SupplementsDue(BaseModel):
    date: date
    training_day: bool
    hockey_day: bool
    items: list[SupplementDue]
