from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import ConflictError, NotFoundError
from app.models import Exercise
from app.schemas.exercises import ExerciseCreate, ExerciseReplace


async def list_exercises(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[Exercise], int]:
    total = await session.scalar(select(func.count()).select_from(Exercise))
    result = await session.execute(
        select(Exercise).order_by(Exercise.name.asc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_exercise(session: AsyncSession, exercise_id: UUID) -> Exercise:
    result = await session.execute(select(Exercise).where(Exercise.id == exercise_id))
    exercise = result.scalar_one_or_none()
    if exercise is None:
        raise NotFoundError("Exercise not found", code="EXERCISE_NOT_FOUND")
    return exercise


async def create_exercise(session: AsyncSession, data: ExerciseCreate) -> Exercise:
    exercise = Exercise(**data.model_dump())
    session.add(exercise)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(
            f"An exercise named '{data.name}' already exists", code="EXERCISE_NAME_CONFLICT"
        ) from exc
    await session.refresh(exercise)
    return exercise


async def replace_exercise(
    session: AsyncSession, exercise_id: UUID, data: ExerciseReplace
) -> Exercise:
    exercise = await get_exercise(session, exercise_id)
    for field, value in data.model_dump().items():
        setattr(exercise, field, value)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(
            f"An exercise named '{data.name}' already exists", code="EXERCISE_NAME_CONFLICT"
        ) from exc
    await session.refresh(exercise)
    return exercise


async def delete_exercise(session: AsyncSession, exercise_id: UUID) -> None:
    exercise = await get_exercise(session, exercise_id)
    await session.delete(exercise)
    await session.commit()
