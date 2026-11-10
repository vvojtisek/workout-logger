from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import WorkoutLog
from app.schemas.training_load import TrainingLoadQuery, TrainingLoadResponse, TrainingLoadWeek
from app.services.volume_rules import apply_to_logs


async def weekly_training_load(
    session: AsyncSession, query: TrainingLoadQuery
) -> TrainingLoadResponse:
    date_from, date_to = query.utc_bounds()
    zone = ZoneInfo(query.timezone)
    first = query.first_week()
    weeks = [
        TrainingLoadWeek(week_start=first + timedelta(weeks=index)) for index in range(query.weeks)
    ]
    result = await session.scalars(
        select(WorkoutLog)
        .options(selectinload(WorkoutLog.exercises))
        .where(
            WorkoutLog.performed_at >= date_from,
            WorkoutLog.performed_at < date_to,
            WorkoutLog.activity_type.is_(None),
        )
    )
    logs = list(result)
    await apply_to_logs(session, logs)

    for log in logs:
        if not log.exercises:
            continue
        local_date = log.performed_at.astimezone(zone).date()
        week = weeks[(local_date - first).days // 7]
        week.gym_sessions += 1
        week.logged_sets += sum(exercise.sets_count for exercise in log.exercises)
        week.volume_kg += log.total_volume_kg

    for week in weeks:
        week.volume_kg = round(week.volume_kg, 1)
    return TrainingLoadResponse(timezone=query.timezone, weeks=weeks)
