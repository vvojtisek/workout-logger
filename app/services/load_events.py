from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import LoadEvent
from app.schemas.load_events import LoadEventCreate, LoadEventOccurrence, LoadEventReplace


async def list_load_events(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[LoadEvent], int]:
    total = await session.scalar(select(func.count()).select_from(LoadEvent))
    result = await session.execute(
        select(LoadEvent)
        .order_by(LoadEvent.weekday.asc(), LoadEvent.start_time.asc(), LoadEvent.name.asc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_load_event(session: AsyncSession, event_id: UUID) -> LoadEvent:
    event = await session.scalar(select(LoadEvent).where(LoadEvent.id == event_id))
    if event is None:
        raise NotFoundError("Load event not found", code="LOAD_EVENT_NOT_FOUND")
    return event


async def create_load_event(session: AsyncSession, data: LoadEventCreate) -> LoadEvent:
    event = LoadEvent(**data.model_dump())
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return event


async def replace_load_event(
    session: AsyncSession, event_id: UUID, data: LoadEventReplace
) -> LoadEvent:
    event = await get_load_event(session, event_id)
    for field, value in data.model_dump().items():
        setattr(event, field, value)
    await session.commit()
    await session.refresh(event)
    return event


async def delete_load_event(session: AsyncSession, event_id: UUID) -> None:
    event = await get_load_event(session, event_id)
    await session.delete(event)
    await session.commit()


def expand_occurrences(
    events: list[LoadEvent], date_from: date, date_to: date
) -> list[LoadEventOccurrence]:
    """Every dated occurrence of each event that falls inside [date_from, date_to]
    and inside the event's season, ordered by date then start time."""
    occurrences: list[LoadEventOccurrence] = []
    for event in events:
        first = max(date_from, event.season_start)
        last = min(date_to, event.season_end)
        if last < first:
            continue
        day = first + timedelta(days=(event.weekday - first.weekday()) % 7)
        while day <= last:
            occurrences.append(
                LoadEventOccurrence(
                    event_id=event.id,
                    date=day,
                    start_time=event.start_time,
                    duration_minutes=event.duration_minutes,
                    kind=event.kind,  # type: ignore[arg-type]
                    name=event.name,
                )
            )
            day += timedelta(days=7)
    occurrences.sort(key=lambda item: (item.date, item.start_time, item.name))
    return occurrences


async def get_occurrences(
    session: AsyncSession, date_from: date, date_to: date
) -> list[LoadEventOccurrence]:
    result = await session.execute(
        select(LoadEvent).where(
            LoadEvent.season_start <= date_to,
            LoadEvent.season_end >= date_from,
        )
    )
    return expand_occurrences(list(result.scalars().all()), date_from, date_to)
