from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.meal_entries import (
    MealEntryCreate,
    MealEntryRead,
    MealEntryReplace,
    PaginatedMealEntriesResponse,
)
from app.services import meal_entries as meal_entries_service

router = APIRouter(prefix="/meal-entries", tags=["meal entries"])


@router.get(
    "",
    operation_id="list_meal_entries",
    summary="List meal entries",
    description="Returns a paginated list of meal entries with their items, most recent first.",
    response_model=PaginatedMealEntriesResponse,
)
async def list_meal_entries(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedMealEntriesResponse:
    items, total = await meal_entries_service.list_meal_entries(session, limit, offset)
    return PaginatedMealEntriesResponse(
        items=[MealEntryRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_meal_entry",
    summary="Log a meal entry",
    description=(
        "Creates a meal entry together with all of its logged food items in a single "
        "transaction. Each item either references a food (nutrition is snapshotted, scaled "
        "by quantity) or supplies its own nutrition values directly."
    ),
    response_model=MealEntryRead,
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": ErrorResponse, "description": "Referenced food not found"}},
)
async def create_meal_entry(
    data: MealEntryCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> MealEntryRead:
    meal_entry = await meal_entries_service.create_meal_entry(session, data)
    response.headers["Location"] = f"/api/v1/meal-entries/{meal_entry.id}"
    return MealEntryRead.model_validate(meal_entry)


@router.get(
    "/{meal_entry_id}",
    operation_id="get_meal_entry",
    summary="Get a meal entry",
    response_model=MealEntryRead,
    responses={404: {"model": ErrorResponse, "description": "Meal entry not found"}},
)
async def get_meal_entry(
    meal_entry_id: UUID, session: AsyncSession = Depends(get_session)
) -> MealEntryRead:
    meal_entry = await meal_entries_service.get_meal_entry(session, meal_entry_id)
    return MealEntryRead.model_validate(meal_entry)


@router.put(
    "/{meal_entry_id}",
    operation_id="replace_meal_entry",
    summary="Replace a meal entry",
    description="Fully replaces a meal entry and atomically replaces its collection of items.",
    response_model=MealEntryRead,
    responses={
        404: {"model": ErrorResponse, "description": "Meal entry or referenced food not found"},
    },
)
async def replace_meal_entry(
    meal_entry_id: UUID,
    data: MealEntryReplace,
    session: AsyncSession = Depends(get_session),
) -> MealEntryRead:
    meal_entry = await meal_entries_service.replace_meal_entry(session, meal_entry_id, data)
    return MealEntryRead.model_validate(meal_entry)


@router.delete(
    "/{meal_entry_id}",
    operation_id="delete_meal_entry",
    summary="Delete a meal entry",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Meal entry not found"}},
)
async def delete_meal_entry(
    meal_entry_id: UUID, session: AsyncSession = Depends(get_session)
) -> None:
    await meal_entries_service.delete_meal_entry(session, meal_entry_id)
