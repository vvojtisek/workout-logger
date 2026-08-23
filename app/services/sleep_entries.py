from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import SleepEntry
from app.schemas.sleep_entries import (
    SleepEntryCreate,
    SleepEntryRead,
    SleepEntryReplace,
    SleepTrends,
)

_TREND_WINDOWS = (7, 30)


def _time_in_bed_seconds(data: SleepEntryCreate) -> int:
    return int((data.sleep_end - data.sleep_start).total_seconds())


async def list_sleep_entries(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[SleepEntry], int]:
    total = await session.scalar(select(func.count()).select_from(SleepEntry))
    result = await session.execute(
        select(SleepEntry).order_by(SleepEntry.sleep_end.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_sleep_entry(session: AsyncSession, sleep_entry_id: UUID) -> SleepEntry:
    result = await session.execute(select(SleepEntry).where(SleepEntry.id == sleep_entry_id))
    sleep_entry = result.scalar_one_or_none()
    if sleep_entry is None:
        raise NotFoundError("Sleep entry not found", code="SLEEP_ENTRY_NOT_FOUND")
    return sleep_entry


async def create_sleep_entry(session: AsyncSession, data: SleepEntryCreate) -> SleepEntry:
    sleep_entry = SleepEntry(
        sleep_start=data.sleep_start,
        sleep_end=data.sleep_end,
        timezone=data.timezone,
        time_in_bed_seconds=_time_in_bed_seconds(data),
        estimated_sleep_seconds=data.estimated_sleep_seconds,
        awake_seconds=data.awake_seconds,
        quality_score=data.quality_score,
        resting_heart_rate=data.resting_heart_rate,
        notes=data.notes,
        source=data.source,
    )
    session.add(sleep_entry)
    await session.commit()
    await session.refresh(sleep_entry)
    return sleep_entry


async def replace_sleep_entry(
    session: AsyncSession, sleep_entry_id: UUID, data: SleepEntryReplace
) -> SleepEntry:
    sleep_entry = await get_sleep_entry(session, sleep_entry_id)
    sleep_entry.sleep_start = data.sleep_start
    sleep_entry.sleep_end = data.sleep_end
    sleep_entry.timezone = data.timezone
    sleep_entry.time_in_bed_seconds = _time_in_bed_seconds(data)
    sleep_entry.estimated_sleep_seconds = data.estimated_sleep_seconds
    sleep_entry.awake_seconds = data.awake_seconds
    sleep_entry.quality_score = data.quality_score
    sleep_entry.resting_heart_rate = data.resting_heart_rate
    sleep_entry.notes = data.notes
    sleep_entry.source = data.source
    await session.commit()
    await session.refresh(sleep_entry)
    return sleep_entry


async def delete_sleep_entry(session: AsyncSession, sleep_entry_id: UUID) -> None:
    sleep_entry = await get_sleep_entry(session, sleep_entry_id)
    await session.delete(sleep_entry)
    await session.commit()


def _duration_seconds(entry: SleepEntry) -> int:
    return (
        entry.estimated_sleep_seconds
        if entry.estimated_sleep_seconds is not None
        else entry.time_in_bed_seconds
    )


def _average(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


async def get_trends(session: AsyncSession) -> SleepTrends:
    latest_result = await session.execute(
        select(SleepEntry).order_by(SleepEntry.sleep_end.desc()).limit(1)
    )
    latest = latest_result.scalar_one_or_none()
    if latest is None:
        return SleepTrends(
            latest=None,
            average_sleep_seconds_7d=None,
            average_sleep_seconds_30d=None,
            average_quality_score_7d=None,
            average_quality_score_30d=None,
        )

    anchor: date = latest.sleep_date
    max_window = max(_TREND_WINDOWS)
    # A bounded, indexed query on sleep_end; the extra day of slack absorbs
    # the timezone offset between UTC storage and each entry's local date.
    lower_bound = datetime.combine(
        anchor - timedelta(days=max_window), time.min, tzinfo=timezone.utc
    )
    upper_bound = datetime.combine(anchor + timedelta(days=1), time.min, tzinfo=timezone.utc)
    result = await session.execute(
        select(SleepEntry).where(
            SleepEntry.sleep_end >= lower_bound, SleepEntry.sleep_end < upper_bound
        )
    )
    candidates = result.scalars().all()

    windows = {
        days: [e for e in candidates if anchor - timedelta(days=days - 1) <= e.sleep_date <= anchor]
        for days in _TREND_WINDOWS
    }

    return SleepTrends(
        latest=SleepEntryRead.model_validate(latest),
        average_sleep_seconds_7d=_average([_duration_seconds(e) for e in windows[7]]),
        average_sleep_seconds_30d=_average([_duration_seconds(e) for e in windows[30]]),
        average_quality_score_7d=_average(
            [e.quality_score for e in windows[7] if e.quality_score is not None]
        ),
        average_quality_score_30d=_average(
            [e.quality_score for e in windows[30] if e.quality_score is not None]
        ),
    )
