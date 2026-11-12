from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserSettings
from app.schemas.settings import UserSettingsUpdate


async def get_settings(session: AsyncSession) -> UserSettings:
    """There is no setup step: the first read creates the one settings row
    with defaults, same as every other single-user-for-now table."""
    result = await session.execute(select(UserSettings).limit(1))
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = UserSettings()
        session.add(settings)
        await session.commit()
        await session.refresh(settings)
    return settings


async def update_settings(session: AsyncSession, data: UserSettingsUpdate) -> UserSettings:
    settings = await get_settings(session)
    # Keep the existing API field for client compatibility, but the product
    # now has one fixed display and input convention: metric units.
    settings.units = "metric"
    settings.default_rest_compound_seconds = data.default_rest_compound_seconds
    settings.default_rest_isolation_seconds = data.default_rest_isolation_seconds
    if data.barbell_weight_kg is not None:
        settings.barbell_weight_kg = data.barbell_weight_kg
    if data.plate_inventory is not None:
        settings.plate_inventory = [plate.model_dump() for plate in data.plate_inventory]
    await session.commit()
    await session.refresh(settings)
    return settings
