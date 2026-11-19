from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import ColumnElement, Date, Float, func, select, type_coerce
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.models import MealEntry, MealItem, NutritionPlan
from app.schemas.nutrition_dashboard import (
    NutritionDailySummary,
    NutritionRemaining,
    NutritionTarget,
    NutritionTotals,
    NutritionTrendDay,
)
from app.services.nutrition_plans import get_applicable_plan


def _sum_or_zero(column: InstrumentedAttribute[float | None]) -> ColumnElement[float]:
    # COALESCE guarantees a non-null result, but SQLAlchemy types coalesce() from its
    # first argument only, so declare the expression type explicitly.
    return type_coerce(func.coalesce(func.sum(column), 0.0), Float)


def _total_columns() -> tuple[
    ColumnElement[float],
    ColumnElement[float],
    ColumnElement[float],
    ColumnElement[float],
    ColumnElement[float],
]:
    return (
        _sum_or_zero(MealItem.energy_kcal_snapshot),
        _sum_or_zero(MealItem.protein_g_snapshot),
        _sum_or_zero(MealItem.carbohydrate_g_snapshot),
        _sum_or_zero(MealItem.fat_g_snapshot),
        _sum_or_zero(MealItem.fiber_g_snapshot),
    )


def _target_for_plan(plan: NutritionPlan) -> NutritionTarget:
    return NutritionTarget(
        nutrition_plan_id=plan.id,
        name=plan.name,
        energy_target_kcal=plan.energy_target_kcal,
        protein_target_g=plan.protein_target_g,
        carbohydrate_target_g=plan.carbohydrate_target_g,
        fat_target_g=plan.fat_target_g,
        fiber_target_g=plan.fiber_target_g,
    )


async def _get_totals(session: AsyncSession, on_date: date) -> NutritionTotals:
    day_start = datetime.combine(on_date, time.min, tzinfo=UTC)
    day_end = day_start + timedelta(days=1)
    result = await session.execute(
        select(*_total_columns())
        .select_from(MealItem)
        .join(MealEntry, MealItem.meal_entry_id == MealEntry.id)
        .where(MealEntry.consumed_at >= day_start, MealEntry.consumed_at < day_end)
    )
    energy_kcal, protein_g, carbohydrate_g, fat_g, fiber_g = result.one()
    fiber_g = 0.0 if fiber_g is None else fiber_g
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
        target = _target_for_plan(plan)
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


async def get_nutrition_trends(
    session: AsyncSession, date_from: date | None, date_to: date
) -> list[NutritionTrendDay]:
    day = func.date(MealEntry.consumed_at, type_=Date)
    totals_query = (
        select(day, *_total_columns())
        .select_from(MealItem)
        .join(MealEntry, MealItem.meal_entry_id == MealEntry.id)
        .where(MealEntry.consumed_at <= datetime.combine(date_to, time.max, tzinfo=UTC))
        .group_by(day)
        .order_by(day)
    )
    if date_from is not None:
        totals_query = totals_query.where(
            MealEntry.consumed_at >= datetime.combine(date_from, time.min, tzinfo=UTC)
        )
    totals = (await session.execute(totals_query)).all()
    if not totals:
        return []

    plans = list(
        await session.scalars(
            select(NutritionPlan)
            .where(
                NutritionPlan.valid_from <= date_to,
                NutritionPlan.valid_to.is_(None) | (NutritionPlan.valid_to >= totals[0][0]),
            )
            .order_by(NutritionPlan.valid_from.desc(), NutritionPlan.id)
        )
    )
    days: list[NutritionTrendDay] = []
    for on_date, energy, protein, carbs, fat, fiber in totals:
        plan = next(
            (
                candidate
                for candidate in plans
                if candidate.valid_from <= on_date
                and (candidate.valid_to is None or candidate.valid_to >= on_date)
            ),
            None,
        )
        days.append(
            NutritionTrendDay(
                date=on_date,
                totals=NutritionTotals(
                    energy_kcal=energy,
                    protein_g=protein,
                    carbohydrate_g=carbs,
                    fat_g=fat,
                    fiber_g=fiber,
                ),
                target=_target_for_plan(plan) if plan is not None else None,
            )
        )
    return days
