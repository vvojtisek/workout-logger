from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.scheduled_workouts import (
    ScheduledWorkoutCreate,
    ScheduledWorkoutRead,
    ScheduledWorkoutUpdate,
)
from app.schemas.workout_sessions import WorkoutSessionRead
from app.services import scheduled_workouts as scheduled_workouts_service

router = APIRouter(prefix="/scheduled-workouts", tags=["scheduled workouts"])


@router.post(
    "",
    operation_id="schedule_workout",
    summary="Schedule a workout",
    description="Places a workout plan on the calendar for a date. `program_id` is optional.",
    response_model=ScheduledWorkoutRead,
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": ErrorResponse, "description": "Program or plan not found"}},
)
async def schedule_workout(
    data: ScheduledWorkoutCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> ScheduledWorkoutRead:
    scheduled_workout = await scheduled_workouts_service.schedule_workout(session, data)
    response.headers["Location"] = f"/api/v1/scheduled-workouts/{scheduled_workout.id}"
    return ScheduledWorkoutRead.model_validate(scheduled_workout)


@router.get(
    "/{scheduled_workout_id}",
    operation_id="get_scheduled_workout",
    summary="Get a scheduled workout",
    response_model=ScheduledWorkoutRead,
    responses={404: {"model": ErrorResponse, "description": "Scheduled workout not found"}},
)
async def get_scheduled_workout(
    scheduled_workout_id: UUID, session: AsyncSession = Depends(get_session)
) -> ScheduledWorkoutRead:
    scheduled_workout = await scheduled_workouts_service.get_scheduled_workout(
        session, scheduled_workout_id
    )
    return ScheduledWorkoutRead.model_validate(scheduled_workout)


@router.patch(
    "/{scheduled_workout_id}",
    operation_id="reschedule_workout",
    summary="Reschedule or update a scheduled workout",
    description="Moves a scheduled workout to a new date/program, or marks it skipped/scheduled.",
    response_model=ScheduledWorkoutRead,
    responses={
        404: {"model": ErrorResponse, "description": "Scheduled workout or program not found"},
        409: {"model": ErrorResponse, "description": "Status cannot be changed this way"},
    },
)
async def reschedule_workout(
    scheduled_workout_id: UUID,
    data: ScheduledWorkoutUpdate,
    session: AsyncSession = Depends(get_session),
) -> ScheduledWorkoutRead:
    scheduled_workout = await scheduled_workouts_service.reschedule_workout(
        session, scheduled_workout_id, data
    )
    return ScheduledWorkoutRead.model_validate(scheduled_workout)


@router.delete(
    "/{scheduled_workout_id}",
    operation_id="delete_scheduled_workout",
    summary="Unschedule a workout",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Scheduled workout not found"}},
)
async def delete_scheduled_workout(
    scheduled_workout_id: UUID, session: AsyncSession = Depends(get_session)
) -> None:
    await scheduled_workouts_service.delete_scheduled_workout(session, scheduled_workout_id)


@router.post(
    "/{scheduled_workout_id}/start",
    operation_id="start_scheduled_workout",
    summary="Start a scheduled workout",
    description="Starts a real workout session from this scheduled workout's plan and links it.",
    response_model=WorkoutSessionRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Scheduled workout not found"},
        409: {"model": ErrorResponse, "description": "Already started, completed, or skipped"},
    },
)
async def start_scheduled_workout(
    scheduled_workout_id: UUID, session: AsyncSession = Depends(get_session)
) -> WorkoutSessionRead:
    workout_session = await scheduled_workouts_service.start_scheduled_workout(
        session, scheduled_workout_id
    )
    return WorkoutSessionRead.model_validate(workout_session)
