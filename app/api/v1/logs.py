from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.logs import (
    PaginatedLogsResponse,
    WorkoutLogCreate,
    WorkoutLogRead,
    WorkoutLogReplace,
)
from app.services import logs as logs_service

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get(
    "",
    operation_id="list_workout_logs",
    summary="List workout logs",
    description="Returns a paginated list of performed workouts, sorted by performed_at descending. "
    "The date range is [date_from, date_to).",
    response_model=PaginatedLogsResponse,
)
async def list_workout_logs(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    source_plan_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedLogsResponse:
    items, total = await logs_service.list_logs(
        session, limit, offset, date_from=date_from, date_to=date_to, source_plan_id=source_plan_id
    )
    return PaginatedLogsResponse(
        items=[WorkoutLogRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_workout_log",
    summary="Create a workout log",
    description="Creates a performed workout together with all of its exercises in a single transaction. "
    "If source_plan_id is set, the current plan name is copied into source_plan_name.",
    response_model=WorkoutLogRead,
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": ErrorResponse, "description": "Referenced plan not found"}},
)
async def create_workout_log(
    data: WorkoutLogCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> WorkoutLogRead:
    log = await logs_service.create_log(session, data)
    response.headers["Location"] = f"/api/v1/logs/{log.id}"
    return WorkoutLogRead.model_validate(log)


@router.get(
    "/{log_id}",
    operation_id="get_workout_log",
    summary="Get a workout log",
    description="Returns a single performed workout with its exercises.",
    response_model=WorkoutLogRead,
    responses={404: {"model": ErrorResponse, "description": "Log not found"}},
)
async def get_workout_log(
    log_id: UUID, session: AsyncSession = Depends(get_session)
) -> WorkoutLogRead:
    log = await logs_service.get_log(session, log_id)
    return WorkoutLogRead.model_validate(log)


@router.put(
    "/{log_id}",
    operation_id="replace_workout_log",
    summary="Replace a workout log",
    description="Fully replaces a performed workout and atomically replaces its collection of exercises.",
    response_model=WorkoutLogRead,
    responses={404: {"model": ErrorResponse, "description": "Log or referenced plan not found"}},
)
async def replace_workout_log(
    log_id: UUID,
    data: WorkoutLogReplace,
    session: AsyncSession = Depends(get_session),
) -> WorkoutLogRead:
    log = await logs_service.replace_log(session, log_id, data)
    return WorkoutLogRead.model_validate(log)


@router.delete(
    "/{log_id}",
    operation_id="delete_workout_log",
    summary="Delete a workout log",
    description="Deletes a performed workout and all of its exercises.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Log not found"}},
)
async def delete_workout_log(log_id: UUID, session: AsyncSession = Depends(get_session)) -> None:
    await logs_service.delete_log(session, log_id)
