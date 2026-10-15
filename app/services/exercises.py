from uuid import UUID

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import ConflictError, NotFoundError
from app.models import Exercise
from app.schemas.exercises import ExerciseCreate, ExerciseReplace


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_exercises(
    session: AsyncSession, limit: int | None, offset: int, query: str | None = None
) -> tuple[list[Exercise], int]:
    statement = select(Exercise)
    term = (query or "").strip().lower()
    if term:
        pattern = f"%{_escape_like(term)}%"
        # Aliases are a JSON list; searching its text form matches any alias.
        statement = statement.where(
            or_(
                func.lower(Exercise.name).like(pattern, escape="\\"),
                func.lower(cast(Exercise.aliases, String)).like(pattern, escape="\\"),
            )
        )
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    result = await session.execute(
        statement.order_by(Exercise.name.asc()).limit(limit).offset(offset)
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
