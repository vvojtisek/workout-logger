from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.foods import FoodCreate, FoodRead, FoodReplace, PaginatedFoodsResponse
from app.services import foods as foods_service

router = APIRouter(prefix="/foods", tags=["foods"])


@router.get(
    "",
    operation_id="list_foods",
    summary="List foods",
    description="Returns a paginated list of reusable foods, sorted by name. Optionally filter by name/brand with `q`.",
    response_model=PaginatedFoodsResponse,
)
async def list_foods(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=200),
    session: AsyncSession = Depends(get_session),
) -> PaginatedFoodsResponse:
    items, total = await foods_service.list_foods(session, limit, offset, q)
    return PaginatedFoodsResponse(
        items=[FoodRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_food",
    summary="Create a food",
    response_model=FoodRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_food(
    data: FoodCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> FoodRead:
    food = await foods_service.create_food(session, data)
    response.headers["Location"] = f"/api/v1/foods/{food.id}"
    return FoodRead.model_validate(food)


@router.get(
    "/{food_id}",
    operation_id="get_food",
    summary="Get a food",
    response_model=FoodRead,
    responses={404: {"model": ErrorResponse, "description": "Food not found"}},
)
async def get_food(food_id: UUID, session: AsyncSession = Depends(get_session)) -> FoodRead:
    food = await foods_service.get_food(session, food_id)
    return FoodRead.model_validate(food)


@router.put(
    "/{food_id}",
    operation_id="replace_food",
    summary="Replace a food",
    description="Fully replaces a food. Meal items that already reference it keep their nutrition snapshot.",
    response_model=FoodRead,
    responses={404: {"model": ErrorResponse, "description": "Food not found"}},
)
async def replace_food(
    food_id: UUID,
    data: FoodReplace,
    session: AsyncSession = Depends(get_session),
) -> FoodRead:
    food = await foods_service.replace_food(session, food_id, data)
    return FoodRead.model_validate(food)


@router.delete(
    "/{food_id}",
    operation_id="delete_food",
    summary="Delete a food",
    description="Deletes a food. Meal items that already reference it keep their nutrition snapshot.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Food not found"}},
)
async def delete_food(food_id: UUID, session: AsyncSession = Depends(get_session)) -> None:
    await foods_service.delete_food(session, food_id)
