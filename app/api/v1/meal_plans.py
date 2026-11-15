"""Reading coach day plans and working through them in the kitchen and the
shop. Writing plans is PUT /coach/nutrition-plan."""

from datetime import date, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.base import utcnow
from app.schemas.common import ErrorResponse, require_timezone_aware_utc
from app.schemas.meal_plans import (
    DayPlanList,
    DayPlanRead,
    GroceryCheck,
    GroceryList,
    IngredientPatch,
)
from app.services import meal_plans as meal_plans_service

router = APIRouter(tags=["meal plans"])
MAX_RANGE_DAYS = 31
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Not found"}
}


class EatenRequest(BaseModel):
    consumed_at: datetime | None = None

    @field_validator("consumed_at")
    @classmethod
    def requires_timezone(cls, value: datetime | None) -> datetime | None:
        return None if value is None else require_timezone_aware_utc(value)


def _range(start: date | None, end: date | None) -> tuple[date, date]:
    first = start or utcnow().date()
    last = end or first
    if last < first:
        first, last = last, first
    return first, min(last, first + timedelta(days=MAX_RANGE_DAYS - 1))


@router.get(
    "/meal-plans",
    operation_id="list_meal_plans",
    summary="List day meal plans",
    description="Day plans between two dates (default: today), with meals and shopping lists.",
    response_model=DayPlanList,
)
async def list_meal_plans(
    session: Annotated[AsyncSession, Depends(get_session)],
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query()] = None,
) -> DayPlanList:
    first, last = _range(start, end)
    days = await meal_plans_service.list_days(session, first, last)
    return DayPlanList(items=[DayPlanRead.model_validate(day) for day in days])


@router.get(
    "/meal-plans/{plan_date}",
    operation_id="get_meal_plan",
    summary="Get one day's meal plan",
    response_model=DayPlanRead,
    responses=_NOT_FOUND,
)
async def get_meal_plan(
    plan_date: date, session: Annotated[AsyncSession, Depends(get_session)]
) -> DayPlanRead:
    return DayPlanRead.model_validate(await meal_plans_service.get_day(session, plan_date))


@router.delete(
    "/meal-plans/{plan_date}",
    operation_id="delete_meal_plan",
    summary="Delete one day's meal plan",
    description="Meals already logged as eaten stay in the food log.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_NOT_FOUND,
)
async def delete_meal_plan(
    plan_date: date, session: Annotated[AsyncSession, Depends(get_session)]
) -> None:
    await meal_plans_service.delete_day(session, plan_date)


@router.post(
    "/meal-plans/meals/{meal_id}/eaten",
    operation_id="mark_planned_meal_eaten",
    summary="Log a planned meal as eaten",
    description="Adds the meal's macros to the day's food log. Repeating it changes nothing.",
    response_model=DayPlanRead,
    responses=_NOT_FOUND,
)
async def mark_eaten(
    session: Annotated[AsyncSession, Depends(get_session)],
    meal_id: UUID,
    data: Annotated[EatenRequest, Body(default_factory=EatenRequest)],
) -> DayPlanRead:
    day = await meal_plans_service.mark_eaten(session, meal_id, data.consumed_at)
    return DayPlanRead.model_validate(day)


@router.delete(
    "/meal-plans/meals/{meal_id}/eaten",
    operation_id="unmark_planned_meal_eaten",
    summary="Undo logging a planned meal",
    description="Deletes the food log entry the meal created.",
    response_model=DayPlanRead,
    responses=_NOT_FOUND,
)
async def unmark_eaten(
    meal_id: UUID, session: Annotated[AsyncSession, Depends(get_session)]
) -> DayPlanRead:
    return DayPlanRead.model_validate(await meal_plans_service.unmark_eaten(session, meal_id))


@router.patch(
    "/meal-plans/ingredients/{ingredient_id}",
    operation_id="set_ingredient_prepared",
    summary="Tick an ingredient off in the kitchen",
    response_model=DayPlanRead,
    responses=_NOT_FOUND,
)
async def set_prepared(
    ingredient_id: UUID,
    data: IngredientPatch,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DayPlanRead:
    day = await meal_plans_service.set_prepared(session, ingredient_id, data.prepared)
    return DayPlanRead.model_validate(day)


@router.get(
    "/grocery-list",
    operation_id="get_grocery_list",
    summary="Get the shopping list",
    description="Ingredients of the day plans between two dates (default: today), summed by name.",
    response_model=GroceryList,
)
async def get_grocery_list(
    session: Annotated[AsyncSession, Depends(get_session)],
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query()] = None,
) -> GroceryList:
    first, last = _range(start, end)
    return await meal_plans_service.grocery_list(session, first, last)


@router.patch(
    "/grocery-list",
    operation_id="check_grocery_items",
    summary="Tick shopping list items",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_NOT_FOUND,
)
async def check_grocery_items(
    data: GroceryCheck, session: Annotated[AsyncSession, Depends(get_session)]
) -> None:
    await meal_plans_service.set_checked(session, data.ids, data.checked)
