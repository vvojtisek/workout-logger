from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import BodyMetric
from app.schemas.body_metrics import (
    BodyMetricCreate,
    BodyMetricRead,
    BodyMetricReplace,
    BodyMetricTrends,
)

_DELTA_FIELDS = ("weight_kg", "body_fat_percent")
_DELTA_WINDOWS = (7, 14)


async def list_body_metrics(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[BodyMetric], int]:
    total = await session.scalar(select(func.count()).select_from(BodyMetric))
    result = await session.execute(
        select(BodyMetric).order_by(BodyMetric.measured_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_body_metric(session: AsyncSession, body_metric_id: UUID) -> BodyMetric:
    result = await session.execute(select(BodyMetric).where(BodyMetric.id == body_metric_id))
    body_metric = result.scalar_one_or_none()
    if body_metric is None:
        raise NotFoundError("Body metric entry not found", code="BODY_METRIC_NOT_FOUND")
    return body_metric


async def create_body_metric(session: AsyncSession, data: BodyMetricCreate) -> BodyMetric:
    body_metric = BodyMetric(**data.model_dump())
    session.add(body_metric)
    await session.commit()
    await session.refresh(body_metric)
    return body_metric


async def replace_body_metric(
    session: AsyncSession, body_metric_id: UUID, data: BodyMetricReplace
) -> BodyMetric:
    body_metric = await get_body_metric(session, body_metric_id)
    for field, value in data.model_dump().items():
        setattr(body_metric, field, value)
    await session.commit()
    await session.refresh(body_metric)
    return body_metric


async def delete_body_metric(session: AsyncSession, body_metric_id: UUID) -> None:
    body_metric = await get_body_metric(session, body_metric_id)
    await session.delete(body_metric)
    await session.commit()


async def _closest_at_or_before(session: AsyncSession, cutoff: datetime) -> BodyMetric | None:
    result = await session.execute(
        select(BodyMetric)
        .where(BodyMetric.measured_at <= cutoff)
        .order_by(BodyMetric.measured_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_trends(session: AsyncSession) -> BodyMetricTrends:
    latest_result = await session.execute(
        select(BodyMetric).order_by(BodyMetric.measured_at.desc()).limit(1)
    )
    latest = latest_result.scalar_one_or_none()
    if latest is None:
        return BodyMetricTrends(
            latest=None,
            weight_kg_delta_7d=None,
            weight_kg_delta_14d=None,
            body_fat_percent_delta_7d=None,
            body_fat_percent_delta_14d=None,
        )

    deltas: dict[str, float | None] = {}
    for field in _DELTA_FIELDS:
        for days in _DELTA_WINDOWS:
            cutoff = latest.measured_at - timedelta(days=days)
            comparison = await _closest_at_or_before(session, cutoff)
            latest_value = getattr(latest, field)
            comparison_value = getattr(comparison, field) if comparison is not None else None
            delta = (
                round(latest_value - comparison_value, 2)
                if latest_value is not None and comparison_value is not None
                else None
            )
            deltas[f"{field}_delta_{days}d"] = delta

    return BodyMetricTrends(latest=BodyMetricRead.model_validate(latest), **deltas)
