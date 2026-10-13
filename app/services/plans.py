from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import ConflictError, NotFoundError
from app.models import PlanExercise, WorkoutPlan
from app.schemas.plans import WorkoutPlanCreate, WorkoutPlanReplace

_LOAD_EXERCISES = selectinload(WorkoutPlan.exercises)


async def list_plans(
    session: AsyncSession, limit: int, offset: int, owner_id: UUID | None = None
) -> tuple[list[WorkoutPlan], int]:
    count_stmt = select(func.count()).select_from(WorkoutPlan)
    list_stmt = select(WorkoutPlan).options(_LOAD_EXERCISES)
    if owner_id is not None:
        count_stmt = count_stmt.where(WorkoutPlan.owner_id == owner_id)
        list_stmt = list_stmt.where(WorkoutPlan.owner_id == owner_id)
    total = await session.scalar(count_stmt)
    result = await session.execute(
        list_stmt.order_by(WorkoutPlan.name.asc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_plan(
    session: AsyncSession, plan_id: UUID, owner_id: UUID | None = None
) -> WorkoutPlan:
    statement = select(WorkoutPlan).options(_LOAD_EXERCISES).where(WorkoutPlan.id == plan_id)
    if owner_id is not None:
        statement = statement.where(WorkoutPlan.owner_id == owner_id)
    result = await session.execute(statement)
    plan = result.scalar_one_or_none()
    if plan is None:
        raise NotFoundError("Workout plan not found", code="PLAN_NOT_FOUND")
    return plan


async def create_plan(
    session: AsyncSession, data: WorkoutPlanCreate, owner_id: UUID | None = None
) -> WorkoutPlan:
    plan = WorkoutPlan(name=data.name, description=data.description, owner_id=owner_id)
    for index, exercise in enumerate(data.exercises):
        plan.exercises.append(PlanExercise(sort_order=index, **exercise.model_dump()))
    session.add(plan)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(
            f"A workout plan named '{data.name}' already exists", code="PLAN_NAME_CONFLICT"
        ) from exc
    return await get_plan(session, plan.id, owner_id)


async def replace_plan(
    session: AsyncSession, plan_id: UUID, data: WorkoutPlanReplace, owner_id: UUID | None = None
) -> WorkoutPlan:
    plan = await get_plan(session, plan_id, owner_id)
    try:
        plan.name = data.name
        plan.description = data.description
        plan.exercises.clear()
        await session.flush()
        for index, exercise in enumerate(data.exercises):
            plan.exercises.append(PlanExercise(sort_order=index, **exercise.model_dump()))
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(
            f"A workout plan named '{data.name}' already exists", code="PLAN_NAME_CONFLICT"
        ) from exc
    return await get_plan(session, plan_id, owner_id)


async def delete_plan(session: AsyncSession, plan_id: UUID, owner_id: UUID | None = None) -> None:
    plan = await get_plan(session, plan_id, owner_id)
    await session.delete(plan)
    await session.commit()
