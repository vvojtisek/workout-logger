"""Coach-written day plans: meals, ingredients, the shopping list built from
them, kitchen and store checklists, and turning a planned meal into a
logged one."""

from collections.abc import Iterable
from datetime import UTC, date, datetime, time
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import NotFoundError, UnprocessableError
from app.models import (
    DailyMealPlan,
    GroceryItem,
    MealEntry,
    MealItem,
    PlannedMeal,
    PlannedMealIngredient,
)
from app.models.base import utcnow
from app.schemas.meal_plans import (
    DayPlanIn,
    GroceryLine,
    GroceryList,
    NutritionPlanUpsert,
)
from app.services import supplements as supplements_service
from app.services.athlete_profile import exclusion_violations, get_profile

# When a past or future day's meal is marked eaten without a time.
MEAL_HOURS = {"breakfast": 7, "lunch": 12, "snack": 15, "dinner": 18}

_LOAD_DAY = (
    selectinload(DailyMealPlan.meals).selectinload(PlannedMeal.ingredients),
    selectinload(DailyMealPlan.grocery_items),
)


def name_key(name: str) -> str:
    return " ".join(name.lower().split())


async def get_day(session: AsyncSession, plan_date: date) -> DailyMealPlan:
    day = await _find_day(session, plan_date)
    if day is None:
        raise NotFoundError("No meal plan for this date", code="MEAL_PLAN_NOT_FOUND")
    return day


async def _find_day(session: AsyncSession, plan_date: date) -> DailyMealPlan | None:
    return await session.scalar(
        select(DailyMealPlan)
        .options(*_LOAD_DAY)
        .where(DailyMealPlan.plan_date == plan_date)
        .execution_options(populate_existing=True)
    )


async def list_days(session: AsyncSession, start: date, end: date) -> list[DailyMealPlan]:
    return list(
        (
            await session.scalars(
                select(DailyMealPlan)
                .options(*_LOAD_DAY)
                .where(DailyMealPlan.plan_date >= start, DailyMealPlan.plan_date <= end)
                .order_by(DailyMealPlan.plan_date)
                .execution_options(populate_existing=True)
            )
        ).all()
    )


def _grocery_lines(day: DayPlanIn) -> list[tuple[str, str, str, float]]:
    """(display name, key, unit, total quantity), in first-use order."""
    totals: dict[tuple[str, str], list] = {}
    for meal in day.meals:
        for ingredient in meal.ingredients:
            key = (name_key(ingredient.name), ingredient.unit)
            if key in totals:
                totals[key][1] += ingredient.quantity
            else:
                totals[key] = [ingredient.name.strip(), ingredient.quantity]
    return [
        (display, key, unit, round(quantity, 2))
        for (key, unit), (display, quantity) in totals.items()
    ]


async def _check_exclusions(session: AsyncSession, data: NutritionPlanUpsert) -> None:
    profile = await get_profile(session)
    names = [
        name
        for day in data.days
        for meal in day.meals
        for name in (meal.name, *(ingredient.name for ingredient in meal.ingredients))
    ]
    violations = exclusion_violations(profile, names)
    if violations:
        raise UnprocessableError(
            "The plan breaks the athlete's dietary constraints: " + "; ".join(violations[:10]),
            code="DIETARY_CONSTRAINT_VIOLATION",
        )


async def _write_day(session: AsyncSession, data: DayPlanIn, source: str) -> None:
    day = await _find_day(session, data.plan_date)
    kept_checks: dict[tuple[str, str], bool] = {}
    kept_prepared: dict[tuple[str, str, str, str], bool] = {}
    kept_eaten: dict[tuple[str, str], UUID] = {}
    if day is None:
        day = DailyMealPlan(plan_date=data.plan_date)
        session.add(day)
    else:
        kept_checks = {(item.name_key, item.unit): item.checked for item in day.grocery_items}
        for meal in day.meals:
            meal_key = (meal.meal_type, name_key(meal.name))
            if meal.eaten_meal_entry_id is not None:
                kept_eaten[meal_key] = meal.eaten_meal_entry_id
            for ingredient in meal.ingredients:
                kept_prepared[(*meal_key, name_key(ingredient.name), ingredient.unit)] = (
                    ingredient.prepared
                )
        day.meals.clear()
        day.grocery_items.clear()
        await session.flush()

    day.energy_target_kcal = data.energy_target_kcal
    day.protein_target_g = data.protein_target_g
    day.fiber_target_g = data.fiber_target_g
    day.carbohydrate_target_g = data.carbohydrate_target_g
    day.fat_target_g = data.fat_target_g
    day.notes = data.notes
    day.source = source
    day.updated_at = utcnow()
    for meal_order, meal_in in enumerate(data.meals):
        meal_key = (meal_in.meal_type, name_key(meal_in.name))
        meal = PlannedMeal(
            sort_order=meal_order,
            meal_type=meal_in.meal_type,
            name=meal_in.name,
            prep_steps=list(meal_in.prep_steps),
            energy_kcal=meal_in.energy_kcal,
            protein_g=meal_in.protein_g,
            carbohydrate_g=meal_in.carbohydrate_g,
            fat_g=meal_in.fat_g,
            fiber_g=meal_in.fiber_g,
            eaten_meal_entry_id=kept_eaten.pop(meal_key, None),
        )
        for order, ingredient_in in enumerate(meal_in.ingredients):
            meal.ingredients.append(
                PlannedMealIngredient(
                    sort_order=order,
                    name=ingredient_in.name,
                    quantity=ingredient_in.quantity,
                    unit=ingredient_in.unit,
                    note=ingredient_in.note,
                    food_id=ingredient_in.food_id,
                    energy_kcal=ingredient_in.energy_kcal,
                    protein_g=ingredient_in.protein_g,
                    carbohydrate_g=ingredient_in.carbohydrate_g,
                    fat_g=ingredient_in.fat_g,
                    fiber_g=ingredient_in.fiber_g,
                    prepared=kept_prepared.get(
                        (*meal_key, name_key(ingredient_in.name), ingredient_in.unit), False
                    ),
                )
            )
        day.meals.append(meal)
    for order, (display, key, unit, quantity) in enumerate(_grocery_lines(data)):
        day.grocery_items.append(
            GroceryItem(
                sort_order=order,
                name=display,
                name_key=key,
                unit=unit,
                quantity=quantity,
                checked=kept_checks.get((key, unit), False),
            )
        )
    await session.flush()


async def upsert_plan(
    session: AsyncSession, data: NutritionPlanUpsert, *, source: str = "coach"
) -> list[DailyMealPlan]:
    """Writes every day and the supplement stack in one transaction; nothing
    is saved if any part is rejected."""
    await _check_exclusions(session, data)
    try:
        for day in sorted(data.days, key=lambda item: item.plan_date):
            await _write_day(session, day, source)
        if data.supplement_stack is not None:
            await supplements_service.replace_stack(session, data.supplement_stack)
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    dates = [day.plan_date for day in data.days]
    return await list_days(session, min(dates), max(dates))


async def _meal(session: AsyncSession, meal_id: UUID) -> tuple[PlannedMeal, DailyMealPlan]:
    meal = await session.scalar(
        select(PlannedMeal)
        .options(selectinload(PlannedMeal.ingredients))
        .where(PlannedMeal.id == meal_id)
    )
    # Child rows are not owner-scoped themselves; the parent day is.
    day = (
        None
        if meal is None
        else await session.scalar(select(DailyMealPlan).where(DailyMealPlan.id == meal.day_plan_id))
    )
    if meal is None or day is None:
        raise NotFoundError("Planned meal not found", code="PLANNED_MEAL_NOT_FOUND")
    return meal, day


def _consumed_at(meal: PlannedMeal, day: DailyMealPlan) -> datetime:
    now = utcnow()
    if day.plan_date == now.date():
        return now
    return datetime.combine(day.plan_date, time(MEAL_HOURS[meal.meal_type]), tzinfo=UTC)


def _meal_items(meal: PlannedMeal) -> list[MealItem]:
    ingredients = meal.ingredients
    complete = all(
        item.energy_kcal is not None
        and item.protein_g is not None
        and item.carbohydrate_g is not None
        and item.fat_g is not None
        for item in ingredients
    )
    if complete and ingredients:
        return [
            MealItem(
                food_id=item.food_id,
                food_name_snapshot=item.name,
                quantity=item.quantity,
                unit=item.unit,
                energy_kcal_snapshot=item.energy_kcal or 0.0,
                protein_g_snapshot=item.protein_g or 0.0,
                carbohydrate_g_snapshot=item.carbohydrate_g or 0.0,
                fat_g_snapshot=item.fat_g or 0.0,
                fiber_g_snapshot=item.fiber_g,
            )
            for item in ingredients
        ]
    return [
        MealItem(
            food_id=None,
            food_name_snapshot=meal.name,
            quantity=1,
            unit="serving",
            energy_kcal_snapshot=meal.energy_kcal,
            protein_g_snapshot=meal.protein_g,
            carbohydrate_g_snapshot=meal.carbohydrate_g,
            fat_g_snapshot=meal.fat_g,
            fiber_g_snapshot=meal.fiber_g,
        )
    ]


async def mark_eaten(
    session: AsyncSession, meal_id: UUID, consumed_at: datetime | None = None
) -> DailyMealPlan:
    """Logs the planned meal with its macros. Idempotent: a second call
    returns the plan with the same meal entry."""
    meal, day = await _meal(session, meal_id)
    if meal.eaten_meal_entry_id is None:
        entry = MealEntry(
            consumed_at=consumed_at or _consumed_at(meal, day),
            meal_type=meal.meal_type,
            notes=f"Planned meal: {meal.name}",
            items=_meal_items(meal),
        )
        session.add(entry)
        await session.flush()
        meal.eaten_meal_entry_id = entry.id
        await session.commit()
    return await get_day(session, day.plan_date)


async def unmark_eaten(session: AsyncSession, meal_id: UUID) -> DailyMealPlan:
    meal, day = await _meal(session, meal_id)
    if meal.eaten_meal_entry_id is not None:
        entry = await session.scalar(
            select(MealEntry).where(MealEntry.id == meal.eaten_meal_entry_id)
        )
        meal.eaten_meal_entry_id = None
        if entry is not None:
            await session.delete(entry)
        await session.commit()
    return await get_day(session, day.plan_date)


async def set_prepared(session: AsyncSession, ingredient_id: UUID, prepared: bool) -> DailyMealPlan:
    ingredient = await session.scalar(
        select(PlannedMealIngredient).where(PlannedMealIngredient.id == ingredient_id)
    )
    if ingredient is None:
        raise NotFoundError("Ingredient not found", code="INGREDIENT_NOT_FOUND")
    _, day = await _meal(session, ingredient.meal_id)
    ingredient.prepared = prepared
    await session.commit()
    return await get_day(session, day.plan_date)


def _aggregate(days: Iterable[DailyMealPlan]) -> list[GroceryLine]:
    lines: dict[tuple[str, str], GroceryLine] = {}
    for day in days:
        for item in day.grocery_items:
            key = (item.name_key, item.unit)
            line = lines.get(key)
            if line is None:
                lines[key] = GroceryLine(
                    name=item.name,
                    unit=item.unit,
                    quantity=item.quantity,
                    checked=item.checked,
                    item_ids=[item.id],
                    dates=[day.plan_date],
                )
                continue
            line.quantity = round(line.quantity + item.quantity, 2)
            line.checked = line.checked and item.checked
            line.item_ids.append(item.id)
            if day.plan_date not in line.dates:
                line.dates.append(day.plan_date)
    return list(lines.values())


async def grocery_list(session: AsyncSession, start: date, end: date) -> GroceryList:
    return GroceryList(start=start, end=end, items=_aggregate(await list_days(session, start, end)))


async def set_checked(session: AsyncSession, ids: list[UUID], checked: bool) -> None:
    items = list((await session.scalars(select(GroceryItem).where(GroceryItem.id.in_(ids)))).all())
    day_ids = {item.day_plan_id for item in items}
    visible = set(
        (await session.scalars(select(DailyMealPlan.id).where(DailyMealPlan.id.in_(day_ids)))).all()
    )
    if len(items) != len(set(ids)) or not day_ids <= visible:
        raise NotFoundError("Shopping list item not found", code="GROCERY_ITEM_NOT_FOUND")
    for item in items:
        item.checked = checked
    await session.commit()
