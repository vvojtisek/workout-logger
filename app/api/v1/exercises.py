from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.exercises import (
    ExerciseCreate,
    ExerciseRead,
    ExerciseReplace,
    PaginatedExercisesResponse,
)
from app.services import exercises as exercises_service

router = APIRouter(prefix="/exercises", tags=["exercises"])


@router.get(
    "",
    operation_id="list_exercises",
    summary="List exercise catalogue entries",
    description="Returns a paginated list of exercise catalogue entries, sorted by name ascending.",
    response_model=PaginatedExercisesResponse,
)
async def list_exercises(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedExercisesResponse:
    items, total = await exercises_service.list_exercises(session, limit, offset)
    return PaginatedExercisesResponse(
        items=[ExerciseRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_exercise",
    summary="Create an exercise catalogue entry",
    description="Creates a new exercise catalogue entry.",
    response_model=ExerciseRead,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"model": ErrorResponse, "description": "Duplicate exercise name"}},
)
async def create_exercise(
    data: ExerciseCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> ExerciseRead:
    exercise = await exercises_service.create_exercise(session, data)
    response.headers["Location"] = f"/api/v1/exercises/{exercise.id}"
    return ExerciseRead.model_validate(exercise)


@router.get(
    "/{exercise_id}",
    operation_id="get_exercise",
    summary="Get an exercise catalogue entry",
    description="Returns a single exercise catalogue entry.",
    response_model=ExerciseRead,
    responses={404: {"model": ErrorResponse, "description": "Exercise not found"}},
)
async def get_exercise(
    exercise_id: UUID, session: AsyncSession = Depends(get_session)
) -> ExerciseRead:
    exercise = await exercises_service.get_exercise(session, exercise_id)
    return ExerciseRead.model_validate(exercise)


@router.put(
    "/{exercise_id}",
    operation_id="replace_exercise",
    summary="Replace an exercise catalogue entry",
    description="Fully replaces an exercise catalogue entry.",
    response_model=ExerciseRead,
    responses={
        404: {"model": ErrorResponse, "description": "Exercise not found"},
        409: {"model": ErrorResponse, "description": "Duplicate exercise name"},
    },
)
async def replace_exercise(
    exercise_id: UUID,
    data: ExerciseReplace,
    session: AsyncSession = Depends(get_session),
) -> ExerciseRead:
    exercise = await exercises_service.replace_exercise(session, exercise_id, data)
    return ExerciseRead.model_validate(exercise)


@router.delete(
    "/{exercise_id}",
    operation_id="delete_exercise",
    summary="Delete an exercise catalogue entry",
    description="Deletes an exercise catalogue entry. Plan exercises that referenced it keep their name snapshot.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Exercise not found"}},
)
async def delete_exercise(exercise_id: UUID, session: AsyncSession = Depends(get_session)) -> None:
    await exercises_service.delete_exercise(session, exercise_id)
