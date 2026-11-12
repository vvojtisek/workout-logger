from typing import cast

from fastapi import HTTPException
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
    profiles = list(settings.equipment_profiles)
    if data.equipment_profiles is not None:
        profiles = [profile.model_dump() for profile in data.equipment_profiles]
    elif data.barbell_weight_kg is not None or data.plate_inventory is not None:
        active_profile = next(
            (
                profile
                for profile in profiles
                if profile["id"] == settings.active_equipment_profile_id
            ),
            profiles[0],
        )
        if data.barbell_weight_kg is not None:
            active_profile["barbell_weight_kg"] = data.barbell_weight_kg
        if data.plate_inventory is not None:
            active_profile["plate_inventory"] = [
                plate.model_dump() for plate in data.plate_inventory
            ]

    selected_id = data.active_equipment_profile_id or settings.active_equipment_profile_id
    selected = next((profile for profile in profiles if profile["id"] == selected_id), None)
    if selected is None:
        if data.active_equipment_profile_id is not None:
            raise HTTPException(status_code=422, detail="Unknown active equipment profile")
        selected = profiles[0]
        selected_id = str(selected["id"])

    settings.equipment_profiles = profiles
    settings.active_equipment_profile_id = selected_id
    settings.barbell_weight_kg = cast(float, selected["barbell_weight_kg"])
    settings.plate_inventory = cast(list[dict[str, float | int]], selected["plate_inventory"])
    await session.commit()
    await session.refresh(settings)
    return settings
