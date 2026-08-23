from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.nutrition_plans import (
    NutritionPlanCreate,
    NutritionPlanRead,
    NutritionPlanReplace,
    PaginatedNutritionPlansResponse,
)
from app.services import nutrition_plans as nutrition_plans_service

router = APIRouter(prefix="/nutrition-plans", tags=["nutrition plans"])


@router.get(
    "",
    operation_id="list_nutrition_plans",
    summary="List nutrition plans",
    description="Returns a paginated list of nutrition plans, most recently started first.",
    response_model=PaginatedNutritionPlansResponse,
)
async def list_nutrition_plans(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedNutritionPlansResponse:
    items, total = await nutrition_plans_service.list_nutrition_plans(session, limit, offset)
    return PaginatedNutritionPlansResponse(
        items=[NutritionPlanRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_nutrition_plan",
    summary="Create a nutrition plan",
    description="Creates a dated set of daily macro targets. Overlapping plans are allowed.",
    response_model=NutritionPlanRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_nutrition_plan(
    data: NutritionPlanCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> NutritionPlanRead:
    nutrition_plan = await nutrition_plans_service.create_nutrition_plan(session, data)
    response.headers["Location"] = f"/api/v1/nutrition-plans/{nutrition_plan.id}"
    return NutritionPlanRead.model_validate(nutrition_plan)


@router.get(
    "/{nutrition_plan_id}",
    operation_id="get_nutrition_plan",
    summary="Get a nutrition plan",
    response_model=NutritionPlanRead,
    responses={404: {"model": ErrorResponse, "description": "Nutrition plan not found"}},
)
async def get_nutrition_plan(
    nutrition_plan_id: UUID, session: AsyncSession = Depends(get_session)
) -> NutritionPlanRead:
    nutrition_plan = await nutrition_plans_service.get_nutrition_plan(session, nutrition_plan_id)
    return NutritionPlanRead.model_validate(nutrition_plan)


@router.put(
    "/{nutrition_plan_id}",
    operation_id="replace_nutrition_plan",
    summary="Replace a nutrition plan",
    response_model=NutritionPlanRead,
    responses={404: {"model": ErrorResponse, "description": "Nutrition plan not found"}},
)
async def replace_nutrition_plan(
    nutrition_plan_id: UUID,
    data: NutritionPlanReplace,
    session: AsyncSession = Depends(get_session),
) -> NutritionPlanRead:
    nutrition_plan = await nutrition_plans_service.replace_nutrition_plan(
        session, nutrition_plan_id, data
    )
    return NutritionPlanRead.model_validate(nutrition_plan)


@router.delete(
    "/{nutrition_plan_id}",
    operation_id="delete_nutrition_plan",
    summary="Delete a nutrition plan",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Nutrition plan not found"}},
)
async def delete_nutrition_plan(
    nutrition_plan_id: UUID, session: AsyncSession = Depends(get_session)
) -> None:
    await nutrition_plans_service.delete_nutrition_plan(session, nutrition_plan_id)
