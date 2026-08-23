from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import NotFoundError
from app.models import MealEntry, MealItem
from app.schemas.meal_entries import MealEntryCreate, MealEntryReplace, MealItemCreate
from app.services.foods import get_food

_LOAD_ITEMS = selectinload(MealEntry.items)


async def _build_meal_item(session: AsyncSession, data: MealItemCreate) -> MealItem:
    if data.food_id is not None:
        food = await get_food(session, data.food_id)
        scale = data.quantity / food.serving_quantity
        return MealItem(
            food_id=food.id,
            food_name_snapshot=food.name,
            quantity=data.quantity,
            unit=food.serving_unit,
            energy_kcal_snapshot=round(food.energy_kcal * scale, 2),
            protein_g_snapshot=round(food.protein_g * scale, 2),
            carbohydrate_g_snapshot=round(food.carbohydrate_g * scale, 2),
            fat_g_snapshot=round(food.fat_g * scale, 2),
            fiber_g_snapshot=round(food.fiber_g * scale, 2) if food.fiber_g is not None else None,
        )

    assert (
        data.food_name_snapshot is not None
        and data.unit is not None
        and data.energy_kcal is not None
        and data.protein_g is not None
        and data.carbohydrate_g is not None
        and data.fat_g is not None
    ), "ad hoc meal item missing required fields; should be caught by schema validation"
    return MealItem(
        food_id=None,
        food_name_snapshot=data.food_name_snapshot,
        quantity=data.quantity,
        unit=data.unit,
        energy_kcal_snapshot=data.energy_kcal,
        protein_g_snapshot=data.protein_g,
        carbohydrate_g_snapshot=data.carbohydrate_g,
        fat_g_snapshot=data.fat_g,
        fiber_g_snapshot=data.fiber_g,
    )


async def list_meal_entries(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[MealEntry], int]:
    total = await session.scalar(select(func.count()).select_from(MealEntry))
    result = await session.execute(
        select(MealEntry)
        .options(_LOAD_ITEMS)
        .order_by(MealEntry.consumed_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_meal_entry(session: AsyncSession, meal_entry_id: UUID) -> MealEntry:
    result = await session.execute(
        select(MealEntry).options(_LOAD_ITEMS).where(MealEntry.id == meal_entry_id)
    )
    meal_entry = result.scalar_one_or_none()
    if meal_entry is None:
        raise NotFoundError("Meal entry not found", code="MEAL_ENTRY_NOT_FOUND")
    return meal_entry


async def create_meal_entry(session: AsyncSession, data: MealEntryCreate) -> MealEntry:
    meal_entry = MealEntry(consumed_at=data.consumed_at, meal_type=data.meal_type, notes=data.notes)
    for item in data.items:
        meal_entry.items.append(await _build_meal_item(session, item))
    session.add(meal_entry)
    await session.commit()
    return await get_meal_entry(session, meal_entry.id)


async def replace_meal_entry(
    session: AsyncSession, meal_entry_id: UUID, data: MealEntryReplace
) -> MealEntry:
    meal_entry = await get_meal_entry(session, meal_entry_id)
    meal_entry.consumed_at = data.consumed_at
    meal_entry.meal_type = data.meal_type
    meal_entry.notes = data.notes
    meal_entry.items.clear()
    await session.flush()
    for item in data.items:
        meal_entry.items.append(await _build_meal_item(session, item))
    await session.commit()
    return await get_meal_entry(session, meal_entry_id)


async def delete_meal_entry(session: AsyncSession, meal_entry_id: UUID) -> None:
    meal_entry = await get_meal_entry(session, meal_entry_id)
    await session.delete(meal_entry)
    await session.commit()
