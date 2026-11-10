from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import WorkoutLog
from app.models.base import utcnow
from app.schemas.training_load import (
    MuscleVolume,
    TrainingLoadQuery,
    TrainingLoadResponse,
    TrainingLoadWeek,
    WeeklyWorkloadRatio,
)
from app.services.volume_rules import apply_to_logs, profile_for

BASELINE_WEEKS = 4


def _workload_ratio(
    week: TrainingLoadWeek, baseline: list[TrainingLoadWeek], today: date
) -> WeeklyWorkloadRatio:
    comparison = WeeklyWorkloadRatio(
        baseline_start=baseline[0].week_start if len(baseline) == BASELINE_WEEKS else None
    )
    if week.week_start + timedelta(weeks=1) > today:
        comparison.status = "week_incomplete"
        return comparison

    efforts = [entry.session_effort for entry in [*baseline, week]]
    if len(baseline) < BASELINE_WEEKS or any(effort.logged_sessions == 0 for effort in efforts):
        return comparison
    if any(
        effort.rated_sessions != effort.logged_sessions or effort.load_au is None
        for effort in efforts
    ):
        comparison.status = "missing_ratings"
        return comparison

    mean = sum((entry.session_effort.load_au or 0) for entry in baseline) / BASELINE_WEEKS
    comparison.baseline_mean_au = mean
    if mean <= 0:
        comparison.status = "zero_baseline"
        return comparison
    comparison.status = "ready"
    comparison.ratio = (week.session_effort.load_au or 0) / mean
    return comparison


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
    visible_from, date_to = query.utc_bounds()
    zone = ZoneInfo(query.timezone)
    visible_first = query.first_week()
    lookback = min(BASELINE_WEEKS, (visible_first - date.min).days // 7)
    first = visible_first - timedelta(weeks=lookback)
    try:
        date_from = datetime.combine(first, time.min, zone).astimezone(UTC)
    except OverflowError:
        date_from = datetime.min.replace(tzinfo=UTC)
    weeks = [
        TrainingLoadWeek(week_start=first + timedelta(weeks=index))
        for index in range(lookback + query.weeks)
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
    profiles = await apply_to_logs(
        session,
        (log for log in logs if log.performed_at >= visible_from and log.activity_type is None),
    )

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

        if index < lookback or log.activity_type is not None or not log.exercises:
            continue
        week.gym_sessions += 1
        week.logged_sets += sum(exercise.sets_count for exercise in log.exercises)
        for exercise in log.exercises:
            profile = profile_for(profiles, exercise.exercise_name)
            _add_muscle_volume(muscle_volumes[index], exercise.volume_kg, profile.primary_muscles)

    today = utcnow().astimezone(zone).date()
    for index in range(lookback, len(weeks)):
        week, muscle_volume = weeks[index], muscle_volumes[index]
        week.volume_kg = sum(muscle_volume.values()) / 10
        week.muscle_volume = [
            MuscleVolume(muscle=muscle, volume_kg=tenths / 10)
            for muscle, tenths in sorted(
                muscle_volume.items(), key=lambda item: (-item[1], item[0] or "unclassified")
            )
            if tenths
        ]
        week.workload_ratio = _workload_ratio(
            week, weeks[max(0, index - BASELINE_WEEKS) : index], today
        )
    return TrainingLoadResponse(timezone=query.timezone, weeks=weeks[lookback:])
