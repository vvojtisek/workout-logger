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
    settings.units = data.units
    settings.default_rest_compound_seconds = data.default_rest_compound_seconds
    settings.default_rest_isolation_seconds = data.default_rest_isolation_seconds
    await session.commit()
    await session.refresh(settings)
    return settings
