"""An assistant's prescription for one session on one date. It lives in its
own plan (origin "coach") scheduled on that date, so the user's templates
are never edited; replaying the same date and name rewrites it in place."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import ConflictError
from app.models import PlanExercise, ScheduledWorkout, WorkoutPlan
from app.models.base import utcnow
from app.schemas.coach import AdaptiveWorkoutResult, AdaptiveWorkoutUpsert, CoachExerciseIn
from app.schemas.plans import WorkoutPlanRead
from app.schemas.scheduled_workouts import ScheduledWorkoutRead
from app.services.exercise_baseline import exercise_baseline
from app.services.plans import get_plan
from app.services.scheduled_workouts import get_scheduled_workout


def plan_name(data: AdaptiveWorkoutUpsert) -> str:
    return f"{data.name} · {data.scheduled_date:%d/%m/%Y}"


def _exercise(order: int, item: CoachExerciseIn) -> PlanExercise:
    return PlanExercise(
        sort_order=order,
        exercise_name=item.exercise_name,
        catalog_exercise_id=item.catalog_exercise_id,
        exercise_kind=item.exercise_kind,
        target_sets=item.target_sets,
        target_reps_min=item.target_reps_min,
        target_reps_max=item.target_reps_max or item.target_reps_min,
        target_rir=item.target_rir,
        target_rpe=item.target_rpe,
        target_weight_kg=item.target_weight_kg,
        rest_time_seconds=item.rest_time_seconds,
        notes=item.rationale,
        group_key=item.group_key,
        group_order=item.group_order,
        target_source="coach",
        coach_rationale=item.rationale,
    )


async def upsert_adaptive_workout_plan(
    session: AsyncSession, data: AdaptiveWorkoutUpsert
) -> AdaptiveWorkoutResult:
    name = plan_name(data)
    plan = await session.scalar(
        select(WorkoutPlan)
        .options(selectinload(WorkoutPlan.exercises))
        .where(WorkoutPlan.name == name)
    )
    if plan is not None and plan.origin != "coach":
        raise ConflictError(
            f"Your own plan '{name}' has this name; pick another session name",
            code="PLAN_NAME_CONFLICT",
        )
    scheduled = None
    if plan is not None:
        scheduled = await session.scalar(
            select(ScheduledWorkout).where(
                ScheduledWorkout.workout_plan_id == plan.id,
                ScheduledWorkout.scheduled_date == data.scheduled_date,
            )
        )
        if scheduled is not None and scheduled.status != "scheduled":
            raise ConflictError(
                "This session was already started, completed or skipped; prescribe a new one "
                "under another name",
                code="COACH_SESSION_STARTED",
            )

    created = plan is None
    if plan is None:
        plan = WorkoutPlan(name=name, origin="coach")
        session.add(plan)
    else:
        plan.exercises.clear()
        await session.flush()
    plan.description = data.notes
    plan.updated_at = utcnow()
    for order, item in enumerate(data.exercises):
        plan.exercises.append(_exercise(order, item))
    await session.flush()
    if scheduled is None:
        scheduled = ScheduledWorkout(
            workout_plan_id=plan.id,
            scheduled_date=data.scheduled_date,
            status="scheduled",
        )
        session.add(scheduled)
    scheduled.notes = data.notes
    await session.commit()

    stored_plan = await get_plan(session, plan.id)
    baselines = [
        await exercise_baseline(
            session,
            item.exercise_name,
            rep_min=item.target_reps_min,
            rep_max=item.target_reps_max,
            catalog_exercise_id=item.catalog_exercise_id,
        )
        for item in data.exercises
        if item.exercise_kind == "strength"
    ]
    return AdaptiveWorkoutResult(
        created=created,
        scheduled_workout=ScheduledWorkoutRead.model_validate(
            await get_scheduled_workout(session, scheduled.id)
        ),
        plan=WorkoutPlanRead.model_validate(stored_plan),
        baselines=baselines,
    )
