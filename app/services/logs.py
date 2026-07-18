from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import NotFoundError
from app.models import ExerciseLog, WorkoutLog, WorkoutPlan
from app.schemas.logs import WorkoutLogCreate, WorkoutLogReplace

_LOAD_EXERCISES = selectinload(WorkoutLog.exercises)


async def list_logs(
    session: AsyncSession,
    limit: int,
    offset: int,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    source_plan_id: UUID | None = None,
) -> tuple[list[WorkoutLog], int]:
    conditions = []
    if date_from is not None:
        conditions.append(WorkoutLog.performed_at >= date_from)
    if date_to is not None:
        conditions.append(WorkoutLog.performed_at < date_to)
    if source_plan_id is not None:
        conditions.append(WorkoutLog.source_plan_id == source_plan_id)

    count_stmt = select(func.count()).select_from(WorkoutLog)
    list_stmt = select(WorkoutLog).options(_LOAD_EXERCISES)
    for condition in conditions:
        count_stmt = count_stmt.where(condition)
        list_stmt = list_stmt.where(condition)

    total = await session.scalar(count_stmt)
    result = await session.execute(
        list_stmt.order_by(WorkoutLog.performed_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_log(session: AsyncSession, log_id: UUID) -> WorkoutLog:
    result = await session.execute(
        select(WorkoutLog).options(_LOAD_EXERCISES).where(WorkoutLog.id == log_id)
    )
    log = result.scalar_one_or_none()
    if log is None:
        raise NotFoundError("Workout log not found", code="LOG_NOT_FOUND")
    return log


async def _resolve_source_plan_name(
    session: AsyncSession, source_plan_id: UUID | None
) -> str | None:
    if source_plan_id is None:
        return None
    plan = await session.get(WorkoutPlan, source_plan_id)
    if plan is None:
        raise NotFoundError("Referenced workout plan not found", code="PLAN_NOT_FOUND")
    return plan.name


async def create_log(session: AsyncSession, data: WorkoutLogCreate) -> WorkoutLog:
    source_plan_name = await _resolve_source_plan_name(session, data.source_plan_id)

    log = WorkoutLog(
        source_plan_id=data.source_plan_id,
        source_plan_name=source_plan_name,
        performed_at=data.performed_at,
        total_time_minutes=data.total_time_minutes,
        calories_burned=data.calories_burned,
        overall_feeling=data.overall_feeling,
        notes=data.notes,
    )
    for index, exercise in enumerate(data.exercises):
        log.exercises.append(ExerciseLog(sort_order=index, **exercise.model_dump()))
    session.add(log)
    await session.commit()
    return await get_log(session, log.id)


async def replace_log(session: AsyncSession, log_id: UUID, data: WorkoutLogReplace) -> WorkoutLog:
    log = await get_log(session, log_id)
    source_plan_name = await _resolve_source_plan_name(session, data.source_plan_id)

    log.source_plan_id = data.source_plan_id
    log.source_plan_name = source_plan_name
    log.performed_at = data.performed_at
    log.total_time_minutes = data.total_time_minutes
    log.calories_burned = data.calories_burned
    log.overall_feeling = data.overall_feeling
    log.notes = data.notes
    log.exercises.clear()
    await session.flush()
    for index, exercise in enumerate(data.exercises):
        log.exercises.append(ExerciseLog(sort_order=index, **exercise.model_dump()))
    await session.commit()
    return await get_log(session, log_id)


async def delete_log(session: AsyncSession, log_id: UUID) -> None:
    log = await get_log(session, log_id)
    await session.delete(log)
    await session.commit()
