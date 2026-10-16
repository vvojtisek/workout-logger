from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import ConflictError, NotFoundError
from app.models import Location
from app.schemas.locations import LocationCreate, LocationReplace


def _name_conflict(name: str) -> ConflictError:
    return ConflictError(f"A location named '{name}' already exists", code="LOCATION_NAME_CONFLICT")


async def list_locations(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[Location], int]:
    total = await session.scalar(select(func.count()).select_from(Location))
    result = await session.execute(
        select(Location).order_by(Location.name.asc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_location(session: AsyncSession, location_id: UUID) -> Location:
    location = await session.scalar(select(Location).where(Location.id == location_id))
    if location is None:
        raise NotFoundError("Location not found", code="LOCATION_NOT_FOUND")
    return location


async def create_location(session: AsyncSession, data: LocationCreate) -> Location:
    location = Location(**data.model_dump())
    session.add(location)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _name_conflict(data.name) from exc
    await session.refresh(location)
    return location


async def replace_location(
    session: AsyncSession, location_id: UUID, data: LocationReplace
) -> Location:
    location = await get_location(session, location_id)
    for field, value in data.model_dump().items():
        setattr(location, field, value)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise _name_conflict(data.name) from exc
    await session.refresh(location)
    return location


async def delete_location(session: AsyncSession, location_id: UUID) -> None:
    location = await get_location(session, location_id)
    await session.delete(location)
    await session.commit()
