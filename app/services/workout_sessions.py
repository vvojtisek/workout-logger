import math
from datetime import timedelta
from typing import Any, cast
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import ConflictError, NotFoundError
from app.models import ExerciseLog, SessionExercise, SetEntry, WorkoutLog, WorkoutSession
from app.models.base import utcnow
from app.schemas.workout_sessions import (
    SetEntryCreate,
    SetEntryUpdate,
    WorkoutSessionComplete,
    WorkoutSessionFocus,
    WorkoutSessionRestUpdate,
)
from app.services.plans import get_plan

_LOAD_SESSION = selectinload(WorkoutSession.exercises).selectinload(SessionExercise.set_entries)


def _exercise(workout_session: WorkoutSession, exercise_id: UUID) -> SessionExercise:
    exercise = next(
        (item for item in workout_session.exercises if item.id == exercise_id),
        None,
    )
    if exercise is None:
        raise NotFoundError("Session exercise not found", code="SESSION_EXERCISE_NOT_FOUND")
    return exercise


def _focus_next_incomplete(workout_session: WorkoutSession) -> None:
    for exercise in workout_session.exercises:
        saved = {entry.set_number for entry in exercise.set_entries}
        for set_number in range(1, exercise.target_sets + 1):
            if set_number not in saved:
                workout_session.focused_exercise_id = exercise.id
                workout_session.focused_set_number = set_number
                return


async def get_session(session: AsyncSession, session_id: UUID) -> WorkoutSession:
    result = await session.execute(
        select(WorkoutSession).options(_LOAD_SESSION).where(WorkoutSession.id == session_id)
    )
    workout_session = result.scalar_one_or_none()
    if workout_session is None:
        raise NotFoundError("Workout session not found", code="SESSION_NOT_FOUND")
    return workout_session


async def get_active_session(session: AsyncSession) -> WorkoutSession:
    result = await session.execute(
        select(WorkoutSession)
        .options(_LOAD_SESSION)
        .where(WorkoutSession.status == "active")
        .order_by(WorkoutSession.started_at.desc())
        .limit(1)
    )
    workout_session = result.scalar_one_or_none()
    if workout_session is None:
        raise NotFoundError("No active workout session", code="ACTIVE_SESSION_NOT_FOUND")
    return workout_session


async def _latest_history(
    session: AsyncSession, plan_id: UUID, exercise_name: str
) -> ExerciseLog | None:
    result = await session.execute(
        select(ExerciseLog)
        .join(WorkoutLog, ExerciseLog.workout_log_id == WorkoutLog.id)
        .where(
            WorkoutLog.source_plan_id == plan_id,
            ExerciseLog.exercise_name == exercise_name,
        )
        .order_by(WorkoutLog.performed_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def start_session(session: AsyncSession, source_plan_id: UUID) -> tuple[WorkoutSession, bool]:
    existing_result = await session.execute(
        select(WorkoutSession)
        .options(_LOAD_SESSION)
        .where(
            WorkoutSession.source_plan_id == source_plan_id,
            WorkoutSession.status == "active",
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        return existing, False

    plan = await get_plan(session, source_plan_id)
    if not plan.exercises:
        raise ConflictError(
            "Cannot start a workout plan without exercises",
            code="PLAN_HAS_NO_EXERCISES",
        )

    workout_session = WorkoutSession(
        source_plan_id=plan.id,
        source_plan_name=plan.name,
        status="active",
        focused_set_number=1,
    )
    for exercise in plan.exercises:
        history = await _latest_history(session, plan.id, exercise.exercise_name)
        suggested_weight = exercise.target_weight_kg
        suggested_reps = exercise.target_reps_min
        suggestion_source = "plan"
        if history is not None:
            suggested_weight = history.weight_kg
            suggested_reps = history.reps_per_set[0]
            suggestion_source = "history"
        workout_session.exercises.append(
            SessionExercise(
                sort_order=exercise.sort_order,
                exercise_name=exercise.exercise_name,
                exercise_kind=exercise.exercise_kind,
                target_sets=exercise.target_sets,
                target_reps_min=exercise.target_reps_min,
                target_reps_max=exercise.target_reps_max,
                target_weight_kg=exercise.target_weight_kg,
                rest_time_seconds=exercise.rest_time_seconds,
                notes=exercise.notes,
                group_key=exercise.group_key,
                group_order=exercise.group_order,
                suggested_weight_kg=suggested_weight,
                suggested_reps=suggested_reps,
                suggestion_source=suggestion_source,
                status="planned",
            )
        )
    session.add(workout_session)
    await session.flush()
    workout_session.focused_exercise_id = workout_session.exercises[0].id
    await session.commit()
    return await get_session(session, workout_session.id), True


async def save_set(
    session: AsyncSession, session_id: UUID, data: SetEntryCreate
) -> tuple[WorkoutSession, bool]:
    workout_session = await get_session(session, session_id)
    if workout_session.status != "active":
        raise ConflictError("Workout session is not active", code="SESSION_NOT_ACTIVE")

    exercise = _exercise(workout_session, data.session_exercise_id)

    for item in workout_session.exercises:
        for entry in item.set_entries:
            if entry.client_operation_id == data.client_operation_id:
                return workout_session, False
    if data.set_number > exercise.target_sets:
        raise ConflictError("Set number exceeds the exercise target", code="SET_OUT_OF_RANGE")
    if any(entry.set_number == data.set_number for entry in exercise.set_entries):
        raise ConflictError("Set has already been completed", code="SET_ALREADY_COMPLETED")

    exercise.set_entries.append(
        SetEntry(
            set_number=data.set_number,
            weight_kg=data.weight_kg,
            reps=data.reps,
            rir=data.rir,
            added_weight_kg=data.added_weight_kg,
            band_level=data.band_level,
            duration_seconds=data.duration_seconds,
            distance_km=data.distance_km,
            incline_percent=data.incline_percent,
            rpe=data.rpe,
            state=data.state,
            client_operation_id=data.client_operation_id,
        )
    )
    if data.state == "completed":
        workout_session.rest_ends_at = utcnow() + timedelta(seconds=exercise.rest_time_seconds)
    _focus_next_incomplete(workout_session)
    workout_session.version += 1
    await session.commit()
    return await get_session(session, workout_session.id), True


async def update_set(
    session: AsyncSession,
    session_id: UUID,
    entry_id: UUID,
    data: SetEntryUpdate,
) -> WorkoutSession:
    workout_session = await get_session(session, session_id)
    if workout_session.status != "active":
        raise ConflictError("Workout session is not active", code="SESSION_NOT_ACTIVE")
    entry = next(
        (
            entry
            for exercise in workout_session.exercises
            for entry in exercise.set_entries
            if entry.id == entry_id
        ),
        None,
    )
    if entry is None:
        raise NotFoundError("Set entry not found", code="SET_ENTRY_NOT_FOUND")
    entry.weight_kg = data.weight_kg
    entry.reps = data.reps
    entry.rir = data.rir
    entry.added_weight_kg = data.added_weight_kg
    entry.band_level = data.band_level
    entry.duration_seconds = data.duration_seconds
    entry.distance_km = data.distance_km
    entry.incline_percent = data.incline_percent
    entry.rpe = data.rpe
    workout_session.version += 1
    await session.commit()
    return await get_session(session, workout_session.id)


async def delete_set(session: AsyncSession, session_id: UUID, entry_id: UUID) -> WorkoutSession:
    workout_session = await get_session(session, session_id)
    if workout_session.status != "active":
        raise ConflictError("Workout session is not active", code="SESSION_NOT_ACTIVE")
    location = next(
        (
            (exercise, entry)
            for exercise in workout_session.exercises
            for entry in exercise.set_entries
            if entry.id == entry_id
        ),
        None,
    )
    if location is None:
        raise NotFoundError("Set entry not found", code="SET_ENTRY_NOT_FOUND")
    exercise, entry = location
    set_number = entry.set_number
    exercise.set_entries.remove(entry)
    workout_session.focused_exercise_id = exercise.id
    workout_session.focused_set_number = set_number
    workout_session.rest_ends_at = None
    workout_session.version += 1
    await session.commit()
    return await get_session(session, workout_session.id)


async def set_focus(
    session: AsyncSession,
    session_id: UUID,
    data: WorkoutSessionFocus,
) -> WorkoutSession:
    workout_session = await get_session(session, session_id)
    if workout_session.status != "active":
        raise ConflictError("Workout session is not active", code="SESSION_NOT_ACTIVE")
    exercise = _exercise(workout_session, data.session_exercise_id)
    if data.set_number > exercise.target_sets:
        raise ConflictError("Set number exceeds the exercise target", code="SET_OUT_OF_RANGE")
    workout_session.focused_exercise_id = exercise.id
    workout_session.focused_set_number = data.set_number
    workout_session.version += 1
    await session.commit()
    return await get_session(session, workout_session.id)


async def update_rest(
    session: AsyncSession,
    session_id: UUID,
    data: WorkoutSessionRestUpdate,
) -> WorkoutSession:
    workout_session = await get_session(session, session_id)
    workout_session_id = workout_session.id
    if workout_session.status != "active":
        raise ConflictError("Workout session is not active", code="SESSION_NOT_ACTIVE")
    if workout_session.version != data.expected_version:
        raise ConflictError(
            "Workout session has changed; reload and retry",
            code="SESSION_VERSION_CONFLICT",
        )

    rest_ends_at = None
    if not data.skip:
        if workout_session.rest_ends_at is None:
            raise ConflictError("No rest timer is active", code="REST_NOT_ACTIVE")
        now = utcnow()
        adjusted = workout_session.rest_ends_at + timedelta(seconds=data.adjustment_seconds or 0)
        rest_ends_at = max(now, adjusted)

    result = cast(
        CursorResult[Any],
        await session.execute(
            update(WorkoutSession)
            .where(
                WorkoutSession.id == session_id,
                WorkoutSession.status == "active",
                WorkoutSession.version == data.expected_version,
            )
            .values(rest_ends_at=rest_ends_at, version=data.expected_version + 1)
        ),
    )
    if result.rowcount != 1:
        await session.rollback()
        raise ConflictError(
            "Workout session has changed; reload and retry",
            code="SESSION_VERSION_CONFLICT",
        )
    await session.commit()
    session.expire_all()
    return await get_session(session, workout_session_id)


async def complete_session(
    session: AsyncSession, session_id: UUID, data: WorkoutSessionComplete
) -> WorkoutSession:
    workout_session = await get_session(session, session_id)
    if workout_session.status != "active":
        raise ConflictError("Workout session is not active", code="SESSION_NOT_ACTIVE")

    completed_exercises = [
        (exercise, [entry for entry in exercise.set_entries if entry.state == "completed"])
        for exercise in workout_session.exercises
    ]
    completed_exercises = [
        (exercise, entries) for exercise, entries in completed_exercises if entries
    ]
    if not completed_exercises:
        raise ConflictError("Complete at least one set first", code="SESSION_HAS_NO_SETS")

    completed_at = utcnow()
    total_minutes = max(
        1,
        math.ceil((completed_at - workout_session.started_at).total_seconds() / 60),
    )
    workout_log = WorkoutLog(
        source_plan_id=workout_session.source_plan_id,
        source_plan_name=workout_session.source_plan_name,
        performed_at=workout_session.started_at,
        total_time_minutes=total_minutes,
        overall_feeling=data.overall_feeling,
        notes=None,
    )
    for exercise, entries in completed_exercises:
        workout_log.exercises.append(
            ExerciseLog(
                sort_order=exercise.sort_order,
                exercise_name=exercise.exercise_name,
                sets_count=len(entries),
                reps_per_set=[entry.reps for entry in entries],
                weight_kg=entries[-1].weight_kg,
                rest_time_seconds=exercise.rest_time_seconds,
                notes=exercise.notes,
            )
        )
    session.add(workout_log)
    await session.flush()
    workout_session.status = "completed"
    workout_session.completed_at = completed_at
    workout_session.rest_ends_at = None
    workout_session.workout_log_id = workout_log.id
    workout_session.version += 1
    await session.commit()
    return await get_session(session, workout_session.id)


async def delete_session(session: AsyncSession, session_id: UUID) -> None:
    workout_session = await get_session(session, session_id)
    await session.delete(workout_session)
    await session.commit()
