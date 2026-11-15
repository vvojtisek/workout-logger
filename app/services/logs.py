from datetime import datetime
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import NotFoundError, UnprocessableError
from app.models import ExerciseLog, WorkoutLog, WorkoutPlan
from app.schemas.logs import WorkoutLogCreate, WorkoutLogPatch, WorkoutLogRead, WorkoutLogReplace
from app.services.activity_kinds import (
    CARDIO_TYPES,
    RECOVERY_TYPES,
    ActivityCategory,
    level_to_rpe,
)
from app.services.volume_rules import apply_to_logs

_LOAD_EXERCISES = selectinload(WorkoutLog.exercises)
_SET_IDENTITY_FIELDS = (
    "exercise_name",
    "reps_per_set",
    "weight_kg",
    "weight_per_set",
    "rir_per_set",
)
# Columns copied from a create/replace body onto the row, besides the plan
# link and exercises, which need their own handling.
_SCALAR_FIELDS = (
    "performed_at",
    "total_time_minutes",
    "calories_burned",
    "overall_feeling",
    "notes",
    "activity_type",
    "distance_km",
    "effort_rpe",
    "laps",
    "sauna_rounds",
    "activity_name",
    "effort_level",
    "feel_before",
    "feel_after",
    "cycles",
    "cycle_minutes",
    "linked_log_id",
)


def category_condition(category: ActivityCategory):
    if category == "strength":
        return WorkoutLog.activity_type.is_(None)
    if category == "recovery":
        return WorkoutLog.activity_type.in_(RECOVERY_TYPES)
    return WorkoutLog.activity_type.in_(CARDIO_TYPES)


def overlay_changes(current: dict, changes: dict) -> dict:
    """The stored log with `changes` laid over it, keeping derived values in
    step: an RPE that was derived from the old effort level follows a new
    level, and a sauna's legacy sauna_rounds follows its cycles."""
    data = {**current, **changes}
    if "effort_level" in changes and "effort_rpe" not in changes:
        old_level = current.get("effort_level")
        if old_level is not None and current.get("effort_rpe") == level_to_rpe(old_level):
            data["effort_rpe"] = None
    if data.get("activity_type") == "sauna":
        if "cycles" in changes and "sauna_rounds" not in changes:
            data["sauna_rounds"] = changes["cycles"]
        elif "sauna_rounds" in changes and "cycles" not in changes:
            rounds = changes["sauna_rounds"]
            data["cycles"] = rounds if rounds else None
    return data


async def list_logs(
    session: AsyncSession,
    limit: int,
    offset: int,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    source_plan_id: UUID | None = None,
    category: ActivityCategory | None = None,
) -> tuple[list[WorkoutLog], int]:
    conditions = []
    if category is not None:
        conditions.append(category_condition(category))
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
    logs = list(result.scalars().all())
    await apply_to_logs(session, logs)
    return logs, total or 0


async def get_log(session: AsyncSession, log_id: UUID) -> WorkoutLog:
    result = await session.execute(
        select(WorkoutLog).options(_LOAD_EXERCISES).where(WorkoutLog.id == log_id)
    )
    log = result.scalar_one_or_none()
    if log is None:
        raise NotFoundError("Workout log not found", code="LOG_NOT_FOUND")
    await apply_to_logs(session, [log])
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


async def check_linked_log(
    session: AsyncSession, linked_log_id: UUID | None, log_id: UUID | None = None
) -> None:
    if linked_log_id is None:
        return
    if linked_log_id == log_id:
        raise UnprocessableError("A log cannot be linked to itself", code="LINKED_LOG_SELF")
    if await session.get(WorkoutLog, linked_log_id) is None:
        raise NotFoundError("Linked workout log not found", code="LINKED_LOG_NOT_FOUND")


async def create_log(session: AsyncSession, data: WorkoutLogCreate) -> WorkoutLog:
    source_plan_name = await _resolve_source_plan_name(session, data.source_plan_id)
    await check_linked_log(session, data.linked_log_id)

    log = WorkoutLog(
        source_plan_id=data.source_plan_id,
        source_plan_name=source_plan_name,
        **{field: getattr(data, field) for field in _SCALAR_FIELDS},
    )
    for index, exercise in enumerate(data.exercises):
        log.exercises.append(ExerciseLog(sort_order=index, **exercise.model_dump()))
    session.add(log)
    await session.commit()
    return await get_log(session, log.id)


async def replace_log(session: AsyncSession, log_id: UUID, data: WorkoutLogReplace) -> WorkoutLog:
    log = await get_log(session, log_id)
    source_plan_name = await _resolve_source_plan_name(session, data.source_plan_id)
    await check_linked_log(session, data.linked_log_id, log_id)

    # Older clients can replace exercises without knowing about RPE. Keep the
    # ratings only when the complete ordered layout still identifies the same sets.
    stored_rpes = []
    if len(log.exercises) == len(data.exercises) and all(
        all(getattr(current, field) == getattr(new, field) for field in _SET_IDENTITY_FIELDS)
        for current, new in zip(log.exercises, data.exercises, strict=True)
    ):
        stored_rpes = [exercise.rpe_per_set for exercise in log.exercises]

    log.source_plan_id = data.source_plan_id
    log.source_plan_name = source_plan_name
    for field in _SCALAR_FIELDS:
        setattr(log, field, getattr(data, field))
    log.exercises.clear()
    await session.flush()
    for index, exercise in enumerate(data.exercises):
        values = exercise.model_dump()
        if stored_rpes and "rpe_per_set" not in exercise.model_fields_set:
            values["rpe_per_set"] = stored_rpes[index]
        log.exercises.append(ExerciseLog(sort_order=index, **values))
    await session.commit()
    return await get_log(session, log_id)


async def patch_log(session: AsyncSession, log_id: UUID, changes: WorkoutLogPatch) -> WorkoutLog:
    """Overlays the fields the client sent on the stored log and saves the
    result through the same validation and replace path as PUT."""
    current = WorkoutLogRead.model_validate(await get_log(session, log_id))
    data = overlay_changes(
        current.model_dump(include=set(WorkoutLogReplace.model_fields)),
        changes.model_dump(exclude_unset=True),
    )
    try:
        replacement = WorkoutLogReplace.model_validate(data)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False)) from exc
    return await replace_log(session, log_id, replacement)


async def delete_log(session: AsyncSession, log_id: UUID) -> None:
    log = await get_log(session, log_id)
    await session.delete(log)
    await session.commit()
