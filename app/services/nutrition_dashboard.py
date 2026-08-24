from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MealEntry, MealItem
from app.schemas.nutrition_dashboard import (
    NutritionDailySummary,
    NutritionRemaining,
    NutritionTarget,
    NutritionTotals,
)
from app.services.nutrition_plans import get_applicable_plan


async def _get_totals(session: AsyncSession, on_date: date) -> NutritionTotals:
    day_start = datetime.combine(on_date, time.min, tzinfo=UTC)
    day_end = day_start + timedelta(days=1)
    result = await session.execute(
        select(
            func.coalesce(func.sum(MealItem.energy_kcal_snapshot), 0.0),
            func.coalesce(func.sum(MealItem.protein_g_snapshot), 0.0),
            func.coalesce(func.sum(MealItem.carbohydrate_g_snapshot), 0.0),
            func.coalesce(func.sum(MealItem.fat_g_snapshot), 0.0),
            func.coalesce(func.sum(MealItem.fiber_g_snapshot), 0.0),
        )
        .select_from(MealItem)
        .join(MealEntry, MealItem.meal_entry_id == MealEntry.id)
        .where(MealEntry.consumed_at >= day_start, MealEntry.consumed_at < day_end)
    )
    energy_kcal, protein_g, carbohydrate_g, fat_g, fiber_g = result.one()
    return NutritionTotals(
        energy_kcal=energy_kcal,
        protein_g=protein_g,
        carbohydrate_g=carbohydrate_g,
        fat_g=fat_g,
        fiber_g=fiber_g,
    )


async def get_daily_summary(session: AsyncSession, on_date: date) -> NutritionDailySummary:
    totals = await _get_totals(session, on_date)
    plan = await get_applicable_plan(session, on_date)

    target = None
    remaining = None
    if plan is not None:
        target = NutritionTarget(
            nutrition_plan_id=plan.id,
            name=plan.name,
            energy_target_kcal=plan.energy_target_kcal,
            protein_target_g=plan.protein_target_g,
            carbohydrate_target_g=plan.carbohydrate_target_g,
            fat_target_g=plan.fat_target_g,
            fiber_target_g=plan.fiber_target_g,
        )
        remaining = NutritionRemaining(
            energy_kcal=round(plan.energy_target_kcal - totals.energy_kcal, 2),
            protein_g=round(plan.protein_target_g - totals.protein_g, 2),
            carbohydrate_g=round(plan.carbohydrate_target_g - totals.carbohydrate_g, 2),
            fat_g=round(plan.fat_target_g - totals.fat_g, 2),
            fiber_g=(
                round(plan.fiber_target_g - totals.fiber_g, 2)
                if plan.fiber_target_g is not None
                else None
            ),
        )

    return NutritionDailySummary(date=on_date, totals=totals, target=target, remaining=remaining)
