from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import Food
from app.schemas.foods import FoodCreate, FoodReplace


async def list_foods(
    session: AsyncSession, limit: int, offset: int, q: str | None = None
) -> tuple[list[Food], int]:
    filters = []
    if q:
        pattern = f"%{q}%"
        filters.append(or_(Food.name.ilike(pattern), Food.brand.ilike(pattern)))

    total = await session.scalar(select(func.count()).select_from(Food).where(*filters))
    result = await session.execute(
        select(Food).where(*filters).order_by(Food.name.asc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_food(session: AsyncSession, food_id: UUID) -> Food:
    result = await session.execute(select(Food).where(Food.id == food_id))
    food = result.scalar_one_or_none()
    if food is None:
        raise NotFoundError("Food not found", code="FOOD_NOT_FOUND")
    return food


async def create_food(session: AsyncSession, data: FoodCreate) -> Food:
    food = Food(**data.model_dump())
    session.add(food)
    await session.commit()
    await session.refresh(food)
    return food


async def replace_food(session: AsyncSession, food_id: UUID, data: FoodReplace) -> Food:
    food = await get_food(session, food_id)
    for field, value in data.model_dump().items():
        setattr(food, field, value)
    await session.commit()
    await session.refresh(food)
    return food


async def delete_food(session: AsyncSession, food_id: UUID) -> None:
    food = await get_food(session, food_id)
    await session.delete(food)
    await session.commit()
