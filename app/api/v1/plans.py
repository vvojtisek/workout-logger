from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.plans import (
    PaginatedPlansResponse,
    WorkoutPlanCreate,
    WorkoutPlanRead,
    WorkoutPlanReplace,
)
from app.services import plans as plans_service

router = APIRouter(prefix="/plans", tags=["plans"])


@router.get(
    "",
    operation_id="list_workout_plans",
    summary="List workout plans",
    description="Returns a paginated list of workout plans, sorted by name ascending.",
    response_model=PaginatedPlansResponse,
)
async def list_workout_plans(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedPlansResponse:
    items, total = await plans_service.list_plans(session, limit, offset)
    return PaginatedPlansResponse(
        items=[WorkoutPlanRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_workout_plan",
    summary="Create a workout plan",
    description="Creates a workout plan together with all of its planned exercises in a single transaction.",
    response_model=WorkoutPlanRead,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"model": ErrorResponse, "description": "Duplicate plan name"}},
)
async def create_workout_plan(
    data: WorkoutPlanCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> WorkoutPlanRead:
    plan = await plans_service.create_plan(session, data)
    response.headers["Location"] = f"/api/v1/plans/{plan.id}"
    return WorkoutPlanRead.model_validate(plan)


@router.get(
    "/{plan_id}",
    operation_id="get_workout_plan",
    summary="Get a workout plan",
    description="Returns a single workout plan with its planned exercises.",
    response_model=WorkoutPlanRead,
    responses={404: {"model": ErrorResponse, "description": "Plan not found"}},
)
async def get_workout_plan(
    plan_id: UUID, session: AsyncSession = Depends(get_session)
) -> WorkoutPlanRead:
    plan = await plans_service.get_plan(session, plan_id)
    return WorkoutPlanRead.model_validate(plan)


@router.put(
    "/{plan_id}",
    operation_id="replace_workout_plan",
    summary="Replace a workout plan",
    description="Fully replaces a workout plan and atomically replaces its collection of planned exercises.",
    response_model=WorkoutPlanRead,
    responses={
        404: {"model": ErrorResponse, "description": "Plan not found"},
        409: {"model": ErrorResponse, "description": "Duplicate plan name"},
    },
)
async def replace_workout_plan(
    plan_id: UUID,
    data: WorkoutPlanReplace,
    session: AsyncSession = Depends(get_session),
) -> WorkoutPlanRead:
    plan = await plans_service.replace_plan(session, plan_id, data)
    return WorkoutPlanRead.model_validate(plan)


@router.delete(
    "/{plan_id}",
    operation_id="delete_workout_plan",
    summary="Delete a workout plan",
    description="Deletes a workout plan and its planned exercises. Historical workout logs are preserved.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Plan not found"}},
)
async def delete_workout_plan(plan_id: UUID, session: AsyncSession = Depends(get_session)) -> None:
    await plans_service.delete_plan(session, plan_id)
