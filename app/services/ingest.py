from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import BodyMetric, SleepEntry, StepCount, WorkoutLog
from app.schemas.ingest import (
    SessionIngestCreate,
    SleepIngestCreate,
    StepsIngestCreate,
    WeightIngestCreate,
)
from app.services import body_metrics as body_metrics_service
from app.services import logs as logs_service
from app.services import sleep_entries as sleep_entries_service


async def ingest_weight(session: AsyncSession, data: WeightIngestCreate) -> tuple[BodyMetric, bool]:
    result = await session.execute(
        select(BodyMetric).where(
            BodyMetric.source == data.source, BodyMetric.external_id == data.external_id
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, False
    metric = await body_metrics_service.create_body_metric(session, data)
    return metric, True


async def ingest_sleep(session: AsyncSession, data: SleepIngestCreate) -> tuple[SleepEntry, bool]:
    result = await session.execute(
        select(SleepEntry).where(
            SleepEntry.source == data.source, SleepEntry.external_id == data.external_id
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, False
    entry = await sleep_entries_service.create_sleep_entry(session, data)
    entry.external_id = data.external_id
    await session.commit()
    await session.refresh(entry)
    return entry, True


async def ingest_session(
    session: AsyncSession, data: SessionIngestCreate
) -> tuple[WorkoutLog, bool]:
    result = await session.execute(
        select(WorkoutLog)
        .options(selectinload(WorkoutLog.exercises))
        .where(WorkoutLog.source == data.source, WorkoutLog.external_id == data.external_id)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, False
    log = await logs_service.create_log(session, data)
    log.source = data.source
    log.external_id = data.external_id
    # Not session.refresh(): it would expire the eagerly-loaded `exercises`
    # relationship, and re-lazy-loading it outside an active greenlet raises.
    await session.commit()
    return log, True


async def ingest_steps(session: AsyncSession, data: StepsIngestCreate) -> tuple[StepCount, bool]:
    result = await session.execute(
        select(StepCount).where(
            StepCount.source == data.source, StepCount.external_id == data.external_id
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, False
    step_count = StepCount(
        recorded_date=data.recorded_date,
        steps=data.steps,
        source=data.source,
        external_id=data.external_id,
    )
    session.add(step_count)
    await session.commit()
    await session.refresh(step_count)
    return step_count, True
