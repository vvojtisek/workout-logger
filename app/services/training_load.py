import csv
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from io import StringIO
from typing import cast
from unicodedata import category
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import WorkoutLog
from app.models.base import utcnow
from app.schemas.exercises import MovementPattern
from app.schemas.training_load import (
    MuscleVolume,
    MovementPatternSetCount,
    MovementPatternVolume,
    RirSetCount,
    TrainingLoadQuery,
    TrainingLoadResponse,
    TrainingLoadWeek,
    WeeklyWorkloadRatio,
)
from app.services.volume_rules import apply_to_logs, profile_for

BASELINE_WEEKS = 4
CSV_COLUMNS = (
    "record_type",
    "workout_id",
    "performed_at_utc",
    "local_date",
    "week_start",
    "timezone",
    "activity_type",
    "duration_minutes",
    "session_rpe",
    "exercise_number",
    "exercise_name",
    "set_number",
    "weight_kg",
    "reps",
    "rir",
    "set_rpe",
)


async def _workout_logs_in_range(
    session: AsyncSession, date_from: datetime, date_to: datetime
) -> list[WorkoutLog]:
    result = await session.scalars(
        select(WorkoutLog)
        .options(selectinload(WorkoutLog.exercises))
        .where(WorkoutLog.performed_at >= date_from, WorkoutLog.performed_at < date_to)
        .order_by(WorkoutLog.performed_at, WorkoutLog.id)
    )
    return list(result)


def _spreadsheet_text(value: str) -> str:
    first = next(
        (char for char in value if not char.isspace() and category(char) not in {"Cc", "Cf"}), ""
    )
    if value.startswith(("\t", "\r", "\n")) or first in (
        "=",
        "+",
        "-",
        "@",
        "＝",
        "＋",
        "－",
        "＠",
    ):
        return "'" + value
    return value


async def export_training_load_csv(session: AsyncSession, query: TrainingLoadQuery) -> bytes:
    logs = await _workout_logs_in_range(session, *query.utc_bounds())
    zone = ZoneInfo(query.timezone)
    csv_buffer = StringIO(newline="")
    writer = csv.DictWriter(csv_buffer, fieldnames=CSV_COLUMNS, quoting=csv.QUOTE_ALL)
    writer.writeheader()
    for log in logs:
        local_date = log.performed_at.astimezone(zone).date()
        common = {
            "workout_id": log.id,
            "performed_at_utc": log.performed_at.isoformat().replace("+00:00", "Z"),
            "local_date": local_date,
            "week_start": local_date - timedelta(days=local_date.weekday()),
            "timezone": query.timezone,
        }
        writer.writerow(
            {
                **common,
                "record_type": "session",
                "activity_type": log.activity_type,
                "duration_minutes": log.total_time_minutes,
                "session_rpe": log.effort_rpe,
            }
        )
        for exercise in log.exercises:
            rirs = exercise.rir_per_set or []
            rpes = exercise.rpe_per_set or []
            for index, (weight, reps) in enumerate(exercise.sets_with_weights):
                writer.writerow(
                    {
                        **common,
                        "record_type": "set",
                        "exercise_number": exercise.sort_order + 1,
                        "exercise_name": _spreadsheet_text(exercise.exercise_name),
                        "set_number": index + 1,
                        "weight_kg": weight,
                        "reps": reps,
                        "rir": rirs[index] if index < len(rirs) else None,
                        "set_rpe": rpes[index] if index < len(rpes) else None,
                    }
                )
    return csv_buffer.getvalue().encode("utf-8-sig")


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


def _add_movement_pattern_volume(
    totals: dict[str | None, int], volume_kg: float, movement_pattern: str | None
) -> None:
    if volume_kg > 0:
        totals[movement_pattern] += round(volume_kg * 10)


def _add_movement_pattern_sets(
    totals: dict[str | None, int], sets_count: int, movement_pattern: str | None
) -> None:
    totals[movement_pattern] += sets_count


def _add_rir_distribution(
    totals: dict[int | None, int], sets_count: int, rir_per_set: list[int | None] | None
) -> None:
    values = rir_per_set or []
    for index in range(sets_count):
        rir = values[index] if index < len(values) else None
        totals[rir] += 1


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
    pattern_volumes: list[dict[str | None, int]] = [defaultdict(int) for _ in weeks]
    pattern_sets: list[dict[str | None, int]] = [defaultdict(int) for _ in weeks]
    rir_counts: list[dict[int | None, int]] = [defaultdict(int) for _ in weeks]
    logs = await _workout_logs_in_range(session, date_from, date_to)
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
            _add_movement_pattern_volume(
                pattern_volumes[index], exercise.volume_kg, profile.movement_pattern
            )
            _add_movement_pattern_sets(
                pattern_sets[index], exercise.sets_count, profile.movement_pattern
            )
            _add_rir_distribution(rir_counts[index], exercise.sets_count, exercise.rir_per_set)

    today = utcnow().astimezone(zone).date()
    for index in range(lookback, len(weeks)):
        week = weeks[index]
        muscle_volume = muscle_volumes[index]
        pattern_volume = pattern_volumes[index]
        movement_pattern_sets = pattern_sets[index]
        week.volume_kg = sum(muscle_volume.values()) / 10
        week.muscle_volume = [
            MuscleVolume(muscle=muscle, volume_kg=tenths / 10)
            for muscle, tenths in sorted(
                muscle_volume.items(), key=lambda item: (-item[1], item[0] or "unclassified")
            )
            if tenths
        ]
        week.movement_pattern_volume = [
            MovementPatternVolume(
                movement_pattern=cast(MovementPattern | None, pattern), volume_kg=tenths / 10
            )
            for pattern, tenths in sorted(
                pattern_volume.items(),
                key=lambda item: (-item[1], item[0] or "unclassified"),
            )
            if tenths
        ]
        week.movement_pattern_sets = [
            MovementPatternSetCount(
                movement_pattern=cast(MovementPattern | None, pattern), sets=count
            )
            for pattern, count in sorted(
                movement_pattern_sets.items(),
                key=lambda item: (-item[1], item[0] or "unclassified"),
            )
        ]
        week.rir_distribution = [
            RirSetCount(rir=rir, sets=count)
            for rir, count in sorted(
                rir_counts[index].items(), key=lambda item: (item[0] is None, item[0] or 0)
            )
        ]
        week.workload_ratio = _workload_ratio(
            week, weeks[max(0, index - BASELINE_WEEKS) : index], today
        )
    return TrainingLoadResponse(timezone=query.timezone, weeks=weeks[lookback:])
