import csv
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from io import StringIO
from statistics import pstdev
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
    DailyTrainingLoad,
    MuscleVolume,
    SessionEffortByActivity,
    SessionEffortDetail,
    MovementPatternSetCount,
    MovementPatternVolume,
    RirSetCount,
    TrainingLoadQuery,
    TrainingLoadResponse,
    TrainingLoadWeek,
    WeeklyTrainingVariability,
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
    "logged_sessions",
    "rated_sessions",
    "rated_minutes",
    "load_au",
    "daily_mean_au",
    "daily_sd_au",
    "monotony",
    "strain_au",
    "training_variability_status",
    "baseline_start",
    "baseline_mean_au",
    "workload_ratio",
    "workload_ratio_status",
    "activity_baseline_start",
    "activity_baseline_mean_au",
    "activity_workload_ratio",
    "activity_workload_ratio_status",
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


def _session_load_au(log: WorkoutLog) -> int | None:
    if log.effort_rpe is None or log.total_time_minutes <= 0:
        return None
    return log.effort_rpe * log.total_time_minutes


async def export_training_load_csv(session: AsyncSession, query: TrainingLoadQuery) -> bytes:
    logs = await _workout_logs_in_range(session, *query.utc_bounds())
    summary = await weekly_training_load(session, query)
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
                "load_au": _session_load_au(log),
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
    for week in summary.weeks:
        effort = week.session_effort
        variability = week.training_variability
        ratio = week.workload_ratio
        writer.writerow(
            {
                "record_type": "weekly_summary",
                "week_start": week.week_start,
                "timezone": query.timezone,
                "logged_sessions": effort.logged_sessions,
                "rated_sessions": effort.rated_sessions,
                "rated_minutes": effort.rated_minutes,
                "load_au": effort.load_au,
                "daily_mean_au": variability.daily_mean_au,
                "daily_sd_au": variability.daily_sd_au,
                "monotony": variability.monotony,
                "strain_au": variability.strain_au,
                "training_variability_status": variability.status,
                "baseline_start": ratio.baseline_start,
                "baseline_mean_au": ratio.baseline_mean_au,
                "workload_ratio": ratio.ratio,
                "workload_ratio_status": ratio.status,
            }
        )
        for activity in week.session_effort_by_activity:
            writer.writerow(
                {
                    "record_type": "weekly_activity_summary",
                    "week_start": week.week_start,
                    "timezone": query.timezone,
                    "activity_type": activity.activity_type,
                    "logged_sessions": activity.logged_sessions,
                    "rated_sessions": activity.rated_sessions,
                    "rated_minutes": activity.rated_minutes,
                    "load_au": activity.load_au,
                    "activity_baseline_start": activity.workload_ratio.baseline_start,
                    "activity_baseline_mean_au": activity.workload_ratio.baseline_mean_au,
                    "activity_workload_ratio": activity.workload_ratio.ratio,
                    "activity_workload_ratio_status": activity.workload_ratio.status,
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


def _activity_workload_ratio(
    week: TrainingLoadWeek,
    activity_type: str | None,
    baseline: list[TrainingLoadWeek],
    today: date,
) -> WeeklyWorkloadRatio:
    comparison = WeeklyWorkloadRatio(
        baseline_start=baseline[0].week_start if len(baseline) == BASELINE_WEEKS else None
    )
    if week.week_start + timedelta(weeks=1) > today:
        comparison.status = "week_incomplete"
        return comparison

    efforts = [
        next(
            (
                activity
                for activity in entry.session_effort_by_activity
                if activity.activity_type == activity_type
            ),
            None,
        )
        for entry in [*baseline, week]
    ]
    if len(baseline) < BASELINE_WEEKS or any(
        effort is None or effort.logged_sessions == 0 for effort in efforts
    ):
        return comparison
    rated_efforts = [effort for effort in efforts if effort is not None]
    if any(
        effort.rated_sessions != effort.logged_sessions or effort.load_au is None
        for effort in rated_efforts
    ):
        comparison.status = "missing_ratings"
        return comparison

    mean = sum(effort.load_au or 0 for effort in rated_efforts[:-1]) / BASELINE_WEEKS
    comparison.baseline_mean_au = mean
    if mean <= 0:
        comparison.status = "zero_baseline"
        return comparison
    comparison.status = "ready"
    comparison.ratio = (rated_efforts[-1].load_au or 0) / mean
    return comparison


def _training_variability(
    week: TrainingLoadWeek, daily_loads: list[int], today: date
) -> WeeklyTrainingVariability:
    if week.week_start + timedelta(weeks=1) > today:
        return WeeklyTrainingVariability(status="week_incomplete")
    effort = week.session_effort
    if effort.logged_sessions == 0:
        return WeeklyTrainingVariability(status="no_sessions")
    if effort.rated_sessions != effort.logged_sessions:
        return WeeklyTrainingVariability(status="missing_ratings")

    mean = sum(daily_loads) / 7
    standard_deviation = pstdev(daily_loads)
    if standard_deviation == 0:
        return WeeklyTrainingVariability(
            status="zero_variation",
            daily_mean_au=round(mean, 2),
            daily_sd_au=0,
            daily_loads=[
                DailyTrainingLoad(
                    local_date=week.week_start + timedelta(days=weekday), load_au=load_au
                )
                for weekday, load_au in enumerate(daily_loads)
            ],
        )

    monotony = mean / standard_deviation
    strain = (effort.load_au or 0) * monotony
    return WeeklyTrainingVariability(
        status="ready",
        daily_mean_au=round(mean, 2),
        daily_sd_au=round(standard_deviation, 2),
        monotony=round(monotony, 2),
        strain_au=round(strain, 2),
        daily_loads=[
            DailyTrainingLoad(local_date=week.week_start + timedelta(days=weekday), load_au=load_au)
            for weekday, load_au in enumerate(daily_loads)
        ],
    )


def _add_muscle_volume(
    totals: dict[str | None, int],
    set_totals: dict[str | None, int],
    set_count: int,
    volume_kg: float,
    primary_muscles: tuple[str, ...],
) -> None:
    if set_count <= 0:
        return
    muscles: tuple[str | None, ...] = tuple(sorted(set(primary_muscles))) or (None,)
    for muscle in muscles:
        set_totals[muscle] += set_count
    if volume_kg <= 0:
        return
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
    daily_loads = [[0] * 7 for _ in weeks]
    muscle_volumes: list[dict[str | None, int]] = [defaultdict(int) for _ in weeks]
    muscle_sets: list[dict[str | None, int]] = [defaultdict(int) for _ in weeks]
    activity_efforts: list[dict[str | None, SessionEffortByActivity]] = [{} for _ in weeks]
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
        session_load = _session_load_au(log)
        week.session_effort_sessions.append(
            SessionEffortDetail(
                performed_at_utc=log.performed_at,
                local_date=local_date,
                activity_type=log.activity_type,
                duration_minutes=log.total_time_minutes,
                effort_rpe=log.effort_rpe,
                load_au=session_load,
            )
        )
        activity_effort = activity_efforts[index].setdefault(
            log.activity_type,
            SessionEffortByActivity(activity_type=log.activity_type, logged_sessions=0),
        )
        activity_effort.logged_sessions += 1
        if log.effort_rpe is not None and log.total_time_minutes > 0:
            effort.rated_sessions += 1
            effort.rated_minutes += log.total_time_minutes
            effort.load_au = (effort.load_au or 0) + log.effort_rpe * log.total_time_minutes
            activity_effort.rated_sessions += 1
            activity_effort.rated_minutes += log.total_time_minutes
            activity_effort.load_au = (activity_effort.load_au or 0) + (
                log.effort_rpe * log.total_time_minutes
            )
            daily_loads[index][local_date.weekday()] += log.effort_rpe * log.total_time_minutes

        if index < lookback or log.activity_type is not None or not log.exercises:
            continue
        week.gym_sessions += 1
        week.logged_sets += sum(exercise.sets_count for exercise in log.exercises)
        for exercise in log.exercises:
            profile = profile_for(profiles, exercise.exercise_name)
            _add_muscle_volume(
                muscle_volumes[index],
                muscle_sets[index],
                exercise.sets_count,
                exercise.volume_kg,
                profile.primary_muscles,
            )
            _add_movement_pattern_volume(
                pattern_volumes[index], exercise.volume_kg, profile.movement_pattern
            )
            _add_movement_pattern_sets(
                pattern_sets[index], exercise.sets_count, profile.movement_pattern
            )
            _add_rir_distribution(rir_counts[index], exercise.sets_count, exercise.rir_per_set)

    today = utcnow().astimezone(zone).date()
    for week, efforts in zip(weeks, activity_efforts, strict=True):
        week.session_effort_by_activity = sorted(
            efforts.values(),
            key=lambda effort: (effort.activity_type is not None, effort.activity_type or ""),
        )

    for index in range(lookback, len(weeks)):
        week = weeks[index]
        muscle_volume = muscle_volumes[index]
        pattern_volume = pattern_volumes[index]
        movement_pattern_sets = pattern_sets[index]
        week.volume_kg = sum(muscle_volume.values()) / 10
        baseline = weeks[max(0, index - BASELINE_WEEKS) : index]
        for activity in week.session_effort_by_activity:
            activity.workload_ratio = _activity_workload_ratio(
                week, activity.activity_type, baseline, today
            )
        week.muscle_volume = [
            MuscleVolume(
                muscle=muscle,
                set_count=muscle_sets[index][muscle],
                volume_kg=muscle_volume.get(muscle, 0) / 10,
            )
            for muscle in sorted(
                set(muscle_sets[index]) | set(muscle_volume),
                key=lambda item: (-muscle_volume.get(item, 0), item or "unclassified"),
            )
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
        week.workload_ratio = _workload_ratio(week, baseline, today)
        week.training_variability = _training_variability(week, daily_loads[index], today)
    return TrainingLoadResponse(timezone=query.timezone, weeks=weeks[lookback:])
