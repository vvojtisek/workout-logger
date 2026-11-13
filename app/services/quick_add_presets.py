from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import QuickAddPreset
from app.schemas.quick_add_presets import QuickAddPresetCreate, QuickAddPresetReplace


async def list_presets(session: AsyncSession) -> list[QuickAddPreset]:
    result = await session.execute(
        select(QuickAddPreset).order_by(QuickAddPreset.position.asc(), QuickAddPreset.name.asc())
    )
    return list(result.scalars().all())


async def get_preset(session: AsyncSession, preset_id: UUID) -> QuickAddPreset:
    result = await session.execute(select(QuickAddPreset).where(QuickAddPreset.id == preset_id))
    preset = result.scalar_one_or_none()
    if preset is None:
        raise NotFoundError("Quick-add preset not found", code="QUICK_ADD_PRESET_NOT_FOUND")
    return preset


async def create_preset(session: AsyncSession, data: QuickAddPresetCreate) -> QuickAddPreset:
    preset = QuickAddPreset(**data.model_dump())
    session.add(preset)
    await session.commit()
    await session.refresh(preset)
    return preset


async def replace_preset(
    session: AsyncSession, preset_id: UUID, data: QuickAddPresetReplace
) -> QuickAddPreset:
    preset = await get_preset(session, preset_id)
    for field, value in data.model_dump().items():
        setattr(preset, field, value)
    await session.commit()
    await session.refresh(preset)
    return preset


async def delete_preset(session: AsyncSession, preset_id: UUID) -> None:
    preset = await get_preset(session, preset_id)
    await session.delete(preset)
    await session.commit()
