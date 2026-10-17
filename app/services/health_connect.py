"""Maps the HC Webhook app's Health Connect payload onto this app's own rows.

The payload carries no record ids, so each record is keyed by its own start
time (or local day, for steps). Re-sending a record is therefore a no-op, and a
record the source later revised updates the row it created. A record that
overlaps something already logged by hand merges into that row rather than
creating a second one: measured values from the watch fill in or replace
measured fields, and whatever a person rated or wrote stays.
"""

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SleepEntry, StepCount, WorkoutLog
from app.schemas.ingest import (
    HcExercise,
    HcSleep,
    HcSteps,
    HcTypeSummary,
    HealthConnectIngestResult,
    HealthConnectPayload,
)

SOURCE = "health_connect"

# SleepSessionRecord.STAGE_TYPE_*: AWAKE, OUT_OF_BED, AWAKE_IN_BED vs
# SLEEPING, LIGHT, DEEP, REM. UNKNOWN (0) counts as neither.
_AWAKE_STAGES = {"1", "3", "7"}
_ASLEEP_STAGES = {"2", "4", "5", "6"}

# ExerciseSessionRecord.EXERCISE_TYPE_* -> WorkoutLog.activity_type. A value
# of None is a strength workout, the same as one logged in the app.
_STRENGTH = None
_ACTIVITY_BY_TYPE: dict[str, str | None] = {
    "38": "ice_hockey",
    "73": "swimming",
    "74": "swimming",
    "8": "cycling",
    "9": "cycling",
    "37": "hiking",
    "56": "running",
    "57": "running",
    "13": _STRENGTH,
    "70": _STRENGTH,
    "81": _STRENGTH,
}
# Walks are auto-detected all day long and already count in the step total;
# guided breathing is not training.
_SKIPPED_TYPES = {"79", "33"}
# The in-app activity form's default feeling ("OK"); the watch has no rating.
_DEFAULT_FEELING = 3


def _local_day_bounds(day: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
    return start, end


async def ingest(
    session: AsyncSession, payload: HealthConnectPayload, tz_name: str
) -> HealthConnectIngestResult:
    zone = ZoneInfo(tz_name)
    result = HealthConnectIngestResult(
        steps=await _ingest_steps(session, payload.steps, zone),
        sleep=await _ingest_sleep(session, payload.sleep, tz_name),
        exercise=await _ingest_exercise(session, payload.exercise, zone),
    )
    await session.commit()
    return result


async def _ingest_steps(
    session: AsyncSession, records: list[HcSteps], zone: ZoneInfo
) -> HcTypeSummary:
    summary = HcTypeSummary()
    by_day: dict[date, list[HcSteps]] = defaultdict(list)
    for record in records:
        by_day[record.start_time.astimezone(zone).date()].append(record)

    for day, day_records in sorted(by_day.items()):
        total = sum(record.count for record in day_records)
        # The oldest day in the app's rolling window is clamped to start
        # mid-day, so its total is partial: it may raise a stored total but
        # never lower it. A record starting at local midnight is the full day.
        covers_whole_day = min(r.start_time for r in day_records) <= _local_day_bounds(day, zone)[0]
        external_id = f"day:{day.isoformat()}"
        existing = await session.scalar(
            select(StepCount).where(
                StepCount.source == SOURCE, StepCount.external_id == external_id
            )
        )
        if existing is None:
            session.add(
                StepCount(recorded_date=day, steps=total, source=SOURCE, external_id=external_id)
            )
            summary.created += 1
        elif existing.steps != total and (covers_whole_day or total > existing.steps):
            existing.steps = total
            summary.updated += 1
        else:
            summary.unchanged += 1
    await session.flush()
    return summary


def _stage_seconds(record: HcSleep, stages: set[str]) -> int:
    return sum(stage.duration_seconds for stage in record.stages if stage.stage in stages)


async def _ingest_sleep(
    session: AsyncSession, records: list[HcSleep], tz_name: str
) -> HcTypeSummary:
    summary = HcTypeSummary()
    for record in records:
        end = record.session_end_time
        start = end - timedelta(seconds=record.duration_seconds)
        asleep = _stage_seconds(record, _ASLEEP_STAGES) if record.stages else None
        awake = _stage_seconds(record, _AWAKE_STAGES) if record.stages else None
        external_id = f"sleep:{start.isoformat()}"

        entry = await session.scalar(
            select(SleepEntry).where(
                SleepEntry.source == SOURCE, SleepEntry.external_id == external_id
            )
        )
        merged = False
        if entry is None:
            entry = await session.scalar(
                select(SleepEntry)
                .where(SleepEntry.sleep_start < end, SleepEntry.sleep_end > start)
                .order_by(SleepEntry.sleep_end)
                .limit(1)
            )
            merged = entry is not None and entry.source != SOURCE

        if entry is None:
            session.add(
                SleepEntry(
                    sleep_start=start,
                    sleep_end=end,
                    timezone=tz_name,
                    time_in_bed_seconds=record.duration_seconds,
                    estimated_sleep_seconds=asleep,
                    awake_seconds=awake,
                    source=SOURCE,
                    external_id=external_id,
                )
            )
            await session.flush()
            summary.created += 1
            continue

        measured = {
            "sleep_start": start,
            "sleep_end": end,
            "time_in_bed_seconds": record.duration_seconds,
            "source": SOURCE,
            "external_id": external_id,
        }
        if record.stages:
            measured["estimated_sleep_seconds"] = asleep
            measured["awake_seconds"] = awake
        changed = any(getattr(entry, field) != value for field, value in measured.items())
        for field, value in measured.items():
            setattr(entry, field, value)
        await session.flush()
        if merged:
            summary.merged += 1
        elif changed:
            summary.updated += 1
        else:
            summary.unchanged += 1
    return summary


async def _ingest_exercise(
    session: AsyncSession, records: list[HcExercise], zone: ZoneInfo
) -> HcTypeSummary:
    summary = HcTypeSummary()
    for record in records:
        minutes = min(round(record.duration_seconds / 60), 1440)
        if record.type in _SKIPPED_TYPES or minutes < 1:
            summary.skipped += 1
            continue
        activity_type = _ACTIVITY_BY_TYPE.get(record.type, "other")
        distance_km = round(record.distance_meters / 1000, 2) if record.distance_meters else None
        external_id = f"exercise:{record.start_time.isoformat()}"

        log = await session.scalar(
            select(WorkoutLog).where(
                WorkoutLog.source == SOURCE, WorkoutLog.external_id == external_id
            )
        )
        if log is None:
            # The same kind of session on the same local day is the one
            # already logged (by hand, in the app, or from a revised record).
            day_start, day_end = _local_day_bounds(record.start_time.astimezone(zone).date(), zone)
            same_kind = (
                WorkoutLog.activity_type.is_(None)
                if activity_type is None
                else WorkoutLog.activity_type == activity_type
            )
            log = await session.scalar(
                select(WorkoutLog)
                .where(
                    WorkoutLog.performed_at >= day_start,
                    WorkoutLog.performed_at < day_end,
                    same_kind,
                )
                .order_by(WorkoutLog.performed_at)
                .limit(1)
            )
            if log is not None and log.source != SOURCE:
                if log.distance_km is None and distance_km is not None:
                    log.distance_km = distance_km
                await session.flush()
                summary.merged += 1
                continue

        if log is None:
            session.add(
                WorkoutLog(
                    performed_at=record.start_time,
                    total_time_minutes=minutes,
                    overall_feeling=_DEFAULT_FEELING,
                    activity_type=activity_type,
                    distance_km=distance_km,
                    notes=record.title,
                    source=SOURCE,
                    external_id=external_id,
                )
            )
            await session.flush()
            summary.created += 1
            continue

        measured = {
            "performed_at": record.start_time,
            "total_time_minutes": minutes,
            "distance_km": distance_km,
            "external_id": external_id,
        }
        changed = any(getattr(log, field) != value for field, value in measured.items())
        for field, value in measured.items():
            setattr(log, field, value)
        await session.flush()
        if changed:
            summary.updated += 1
        else:
            summary.unchanged += 1
    return summary
