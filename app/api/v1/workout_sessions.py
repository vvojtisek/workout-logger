from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.workout_sessions import (
    SetEntryCreate,
    SetEntryUpdate,
    WorkoutSessionComplete,
    WorkoutSessionFocus,
    WorkoutSessionRead,
    WorkoutSessionStart,
)
from app.services import workout_sessions as workout_sessions_service

router = APIRouter(prefix="/workout-sessions", tags=["workout sessions"])
SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post(
    "",
    operation_id="start_workout_session",
    response_model=WorkoutSessionRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Plan not found"},
        409: {"model": ErrorResponse, "description": "Plan has no exercises"},
    },
)
async def start_workout_session(
    data: WorkoutSessionStart,
    response: Response,
    session: SessionDep,
) -> WorkoutSessionRead:
    workout_session, created = await workout_sessions_service.start_session(
        session, data.source_plan_id
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    else:
        response.headers["Location"] = f"/api/v1/workout-sessions/{workout_session.id}"
    return WorkoutSessionRead.model_validate(workout_session)


@router.get(
    "/active",
    operation_id="get_active_workout_session",
    response_model=WorkoutSessionRead,
    responses={404: {"model": ErrorResponse, "description": "No active session"}},
)
async def get_active_workout_session(
    session: SessionDep,
) -> WorkoutSessionRead:
    workout_session = await workout_sessions_service.get_active_session(session)
    return WorkoutSessionRead.model_validate(workout_session)


@router.get(
    "/{session_id}",
    operation_id="get_workout_session",
    response_model=WorkoutSessionRead,
    responses={404: {"model": ErrorResponse, "description": "Session not found"}},
)
async def get_workout_session(
    session_id: UUID,
    session: SessionDep,
) -> WorkoutSessionRead:
    workout_session = await workout_sessions_service.get_session(session, session_id)
    return WorkoutSessionRead.model_validate(workout_session)


@router.post(
    "/{session_id}/sets",
    operation_id="complete_workout_session_set",
    response_model=WorkoutSessionRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Session or exercise not found"},
        409: {"model": ErrorResponse, "description": "Set cannot be completed"},
    },
)
async def complete_workout_session_set(
    session_id: UUID,
    data: SetEntryCreate,
    response: Response,
    session: SessionDep,
) -> WorkoutSessionRead:
    workout_session, created = await workout_sessions_service.save_set(session, session_id, data)
    if not created:
        response.status_code = status.HTTP_200_OK
    return WorkoutSessionRead.model_validate(workout_session)


@router.put(
    "/{session_id}/sets/{entry_id}",
    operation_id="update_workout_session_set",
    response_model=WorkoutSessionRead,
)
async def update_workout_session_set(
    session_id: UUID,
    entry_id: UUID,
    data: SetEntryUpdate,
    session: SessionDep,
) -> WorkoutSessionRead:
    workout_session = await workout_sessions_service.update_set(session, session_id, entry_id, data)
    return WorkoutSessionRead.model_validate(workout_session)


@router.delete(
    "/{session_id}/sets/{entry_id}",
    operation_id="delete_workout_session_set",
    response_model=WorkoutSessionRead,
)
async def delete_workout_session_set(
    session_id: UUID,
    entry_id: UUID,
    session: SessionDep,
) -> WorkoutSessionRead:
    workout_session = await workout_sessions_service.delete_set(session, session_id, entry_id)
    return WorkoutSessionRead.model_validate(workout_session)


@router.patch(
    "/{session_id}/focus",
    operation_id="focus_workout_session_set",
    response_model=WorkoutSessionRead,
)
async def focus_workout_session_set(
    session_id: UUID,
    data: WorkoutSessionFocus,
    session: SessionDep,
) -> WorkoutSessionRead:
    workout_session = await workout_sessions_service.set_focus(session, session_id, data)
    return WorkoutSessionRead.model_validate(workout_session)


@router.post(
    "/{session_id}/complete",
    operation_id="complete_workout_session",
    response_model=WorkoutSessionRead,
    responses={
        404: {"model": ErrorResponse, "description": "Session not found"},
        409: {"model": ErrorResponse, "description": "Session cannot be completed"},
    },
)
async def complete_workout_session(
    session_id: UUID,
    data: WorkoutSessionComplete,
    session: SessionDep,
) -> WorkoutSessionRead:
    workout_session = await workout_sessions_service.complete_session(session, session_id, data)
    return WorkoutSessionRead.model_validate(workout_session)


@router.delete(
    "/{session_id}",
    operation_id="delete_workout_session",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Session not found"}},
)
async def delete_workout_session(
    session_id: UUID,
    session: SessionDep,
) -> None:
    await workout_sessions_service.delete_session(session, session_id)
