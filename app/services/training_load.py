from collections import defaultdict
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import WorkoutLog
from app.schemas.training_load import (
    MuscleVolume,
    TrainingLoadQuery,
    TrainingLoadResponse,
    TrainingLoadWeek,
)
from app.services.volume_rules import apply_to_logs, profile_for


def _add_muscle_volume(
    totals: dict[str | None, int], volume_kg: float, primary_muscles: tuple[str, ...]
) -> None:
    if volume_kg <= 0:
        return
    muscles: tuple[str | None, ...] = tuple(sorted(set(primary_muscles))) or (None,)
    # Split whole tenths to preserve the recorded exercise's volume exactly.
    share, remainder = divmod(round(volume_kg * 10), len(muscles))
    for index, muscle in enumerate(muscles):
        totals[muscle] += share + (index < remainder)


async def weekly_training_load(
    session: AsyncSession, query: TrainingLoadQuery
) -> TrainingLoadResponse:
    date_from, date_to = query.utc_bounds()
    zone = ZoneInfo(query.timezone)
    first = query.first_week()
    weeks = [
        TrainingLoadWeek(week_start=first + timedelta(weeks=index)) for index in range(query.weeks)
    ]
    muscle_volumes: list[dict[str | None, int]] = [defaultdict(int) for _ in weeks]
    result = await session.scalars(
        select(WorkoutLog)
        .options(selectinload(WorkoutLog.exercises))
        .where(
            WorkoutLog.performed_at >= date_from,
            WorkoutLog.performed_at < date_to,
        )
    )
    logs = list(result)
    profiles = await apply_to_logs(session, (log for log in logs if log.activity_type is None))

    for log in logs:
        local_date = log.performed_at.astimezone(zone).date()
        index = (local_date - first).days // 7
        week = weeks[index]
        effort = week.session_effort
        effort.logged_sessions += 1
        if log.effort_rpe is not None and log.total_time_minutes > 0:
            effort.rated_sessions += 1
            effort.rated_minutes += log.total_time_minutes
            effort.load_au = (effort.load_au or 0) + log.effort_rpe * log.total_time_minutes

        if log.activity_type is not None or not log.exercises:
            continue
        week.gym_sessions += 1
        week.logged_sets += sum(exercise.sets_count for exercise in log.exercises)
        for exercise in log.exercises:
            profile = profile_for(profiles, exercise.exercise_name)
            _add_muscle_volume(muscle_volumes[index], exercise.volume_kg, profile.primary_muscles)

    for week, muscle_volume in zip(weeks, muscle_volumes, strict=True):
        week.volume_kg = sum(muscle_volume.values()) / 10
        week.muscle_volume = [
            MuscleVolume(muscle=muscle, volume_kg=tenths / 10)
            for muscle, tenths in sorted(
                muscle_volume.items(), key=lambda item: (-item[1], item[0] or "unclassified")
            )
            if tenths
        ]
    return TrainingLoadResponse(timezone=query.timezone, weeks=weeks)
