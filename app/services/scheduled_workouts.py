from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import ConflictError, NotFoundError
from app.models import ScheduledWorkout, WorkoutSession
from app.schemas.scheduled_workouts import ScheduledWorkoutCreate, ScheduledWorkoutUpdate
from app.services import workout_sessions as workout_sessions_service
from app.services.plans import get_plan
from app.services.programs import get_program

_LOAD = (selectinload(ScheduledWorkout.workout_plan), selectinload(ScheduledWorkout.program))


async def get_scheduled_workout(
    session: AsyncSession, scheduled_workout_id: UUID
) -> ScheduledWorkout:
    result = await session.execute(
        select(ScheduledWorkout).options(*_LOAD).where(ScheduledWorkout.id == scheduled_workout_id)
    )
    scheduled_workout = result.scalar_one_or_none()
    if scheduled_workout is None:
        raise NotFoundError("Scheduled workout not found", code="SCHEDULED_WORKOUT_NOT_FOUND")
    return scheduled_workout


async def schedule_workout(session: AsyncSession, data: ScheduledWorkoutCreate) -> ScheduledWorkout:
    if data.program_id is not None:
        await get_program(session, data.program_id)
    await get_plan(session, data.workout_plan_id)

    scheduled_workout = ScheduledWorkout(
        program_id=data.program_id,
        workout_plan_id=data.workout_plan_id,
        scheduled_date=data.scheduled_date,
        status="scheduled",
    )
    session.add(scheduled_workout)
    await session.commit()
    return await get_scheduled_workout(session, scheduled_workout.id)


async def reschedule_workout(
    session: AsyncSession, scheduled_workout_id: UUID, data: ScheduledWorkoutUpdate
) -> ScheduledWorkout:
    scheduled_workout = await get_scheduled_workout(session, scheduled_workout_id)
    fields = data.model_fields_set

    if "program_id" in fields and data.program_id is not None:
        await get_program(session, data.program_id)
    if "status" in fields and data.status is not None:
        if scheduled_workout.status not in ("scheduled", "skipped"):
            raise ConflictError(
                "Only a scheduled or skipped workout can change status this way",
                code="SCHEDULED_WORKOUT_NOT_EDITABLE",
            )
        scheduled_workout.status = data.status
    if "program_id" in fields:
        scheduled_workout.program_id = data.program_id
    if "scheduled_date" in fields and data.scheduled_date is not None:
        scheduled_workout.scheduled_date = data.scheduled_date

    await session.commit()
    return await get_scheduled_workout(session, scheduled_workout_id)


async def delete_scheduled_workout(session: AsyncSession, scheduled_workout_id: UUID) -> None:
    scheduled_workout = await get_scheduled_workout(session, scheduled_workout_id)
    await session.delete(scheduled_workout)
    await session.commit()


async def start_scheduled_workout(
    session: AsyncSession, scheduled_workout_id: UUID
) -> WorkoutSession:
    scheduled_workout = await get_scheduled_workout(session, scheduled_workout_id)
    if scheduled_workout.status != "scheduled":
        raise ConflictError(
            "This scheduled workout has already been started, completed, or skipped",
            code="SCHEDULED_WORKOUT_NOT_SCHEDULED",
        )
    workout_session, _ = await workout_sessions_service.start_session(
        session, scheduled_workout.workout_plan_id
    )
    scheduled_workout.status = "in_progress"
    scheduled_workout.workout_session_id = workout_session.id
    await session.commit()
    return workout_session


async def get_calendar(
    session: AsyncSession, date_from: date, date_to: date
) -> list[ScheduledWorkout]:
    result = await session.execute(
        select(ScheduledWorkout)
        .options(*_LOAD)
        .where(
            ScheduledWorkout.scheduled_date >= date_from,
            ScheduledWorkout.scheduled_date <= date_to,
        )
        .order_by(ScheduledWorkout.scheduled_date.asc())
    )
    return list(result.scalars().all())
