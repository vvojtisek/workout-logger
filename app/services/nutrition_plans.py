from datetime import date
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import NutritionPlan
from app.schemas.nutrition_plans import NutritionPlanCreate, NutritionPlanReplace


async def list_nutrition_plans(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[NutritionPlan], int]:
    total = await session.scalar(select(func.count()).select_from(NutritionPlan))
    result = await session.execute(
        select(NutritionPlan).order_by(NutritionPlan.valid_from.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_nutrition_plan(session: AsyncSession, nutrition_plan_id: UUID) -> NutritionPlan:
    result = await session.execute(
        select(NutritionPlan).where(NutritionPlan.id == nutrition_plan_id)
    )
    nutrition_plan = result.scalar_one_or_none()
    if nutrition_plan is None:
        raise NotFoundError("Nutrition plan not found", code="NUTRITION_PLAN_NOT_FOUND")
    return nutrition_plan


async def create_nutrition_plan(session: AsyncSession, data: NutritionPlanCreate) -> NutritionPlan:
    nutrition_plan = NutritionPlan(**data.model_dump())
    session.add(nutrition_plan)
    await session.commit()
    await session.refresh(nutrition_plan)
    return nutrition_plan


async def replace_nutrition_plan(
    session: AsyncSession, nutrition_plan_id: UUID, data: NutritionPlanReplace
) -> NutritionPlan:
    nutrition_plan = await get_nutrition_plan(session, nutrition_plan_id)
    for field, value in data.model_dump().items():
        setattr(nutrition_plan, field, value)
    await session.commit()
    await session.refresh(nutrition_plan)
    return nutrition_plan


async def delete_nutrition_plan(session: AsyncSession, nutrition_plan_id: UUID) -> None:
    nutrition_plan = await get_nutrition_plan(session, nutrition_plan_id)
    await session.delete(nutrition_plan)
    await session.commit()


async def get_applicable_plan(session: AsyncSession, on_date: date) -> NutritionPlan | None:
    """The plan valid for `on_date`, preferring the one that started most
    recently when more than one overlaps (overlaps are allowed by design)."""
    result = await session.execute(
        select(NutritionPlan)
        .where(
            NutritionPlan.valid_from <= on_date,
            (NutritionPlan.valid_to.is_(None)) | (NutritionPlan.valid_to >= on_date),
        )
        .order_by(NutritionPlan.valid_from.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
