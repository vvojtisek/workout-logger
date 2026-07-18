import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import ExerciseLog, PlanExercise, WorkoutLog, WorkoutPlan
from app.models.base import utcnow


async def test_workout_plan_gets_server_generated_uuid(db_session):
    plan = WorkoutPlan(name="Push Day")
    db_session.add(plan)
    await db_session.commit()

    assert isinstance(plan.id, uuid.UUID)
    assert plan.created_at is not None
    assert plan.updated_at is not None


async def test_plan_exercise_cascade_delete(db_session):
    plan = WorkoutPlan(name="Pull Day")
    plan.exercises.append(
        PlanExercise(
            sort_order=0,
            exercise_name="Deadlift",
            target_sets=3,
            target_reps_min=5,
            target_reps_max=8,
        )
    )
    db_session.add(plan)
    await db_session.commit()
    plan_id = plan.id

    await db_session.delete(plan)
    await db_session.commit()

    remaining = await db_session.execute(
        select(PlanExercise).where(PlanExercise.workout_plan_id == plan_id)
    )
    assert remaining.scalars().all() == []


async def test_foreign_keys_are_enforced(db_session):
    orphan = PlanExercise(
        workout_plan_id=uuid.uuid4(),
        sort_order=0,
        exercise_name="Squat",
        target_sets=3,
        target_reps_min=5,
        target_reps_max=5,
    )
    db_session.add(orphan)
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_duplicate_plan_name_case_insensitive_rejected(db_session):
    db_session.add(WorkoutPlan(name="Leg Day"))
    await db_session.commit()

    db_session.add(WorkoutPlan(name="leg day"))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_deleting_plan_keeps_workout_log_and_nulls_source(db_session):
    plan = WorkoutPlan(name="Full Body")
    db_session.add(plan)
    await db_session.commit()

    log = WorkoutLog(
        source_plan_id=plan.id,
        source_plan_name=plan.name,
        performed_at=utcnow(),
        total_time_minutes=45,
        overall_feeling=4,
    )
    db_session.add(log)
    await db_session.commit()
    log_id = log.id

    await db_session.delete(plan)
    await db_session.commit()
    db_session.expire_all()

    reloaded = await db_session.get(WorkoutLog, log_id)
    assert reloaded is not None
    assert reloaded.source_plan_id is None
    assert reloaded.source_plan_name == "Full Body"


async def test_exercise_log_cascade_delete_with_workout_log(db_session):
    log = WorkoutLog(
        performed_at=utcnow(),
        total_time_minutes=30,
        overall_feeling=3,
    )
    log.exercises.append(
        ExerciseLog(
            sort_order=0,
            exercise_name="Bench Press",
            sets_count=3,
            reps_per_set=[10, 10, 8],
            weight_kg=80,
        )
    )
    db_session.add(log)
    await db_session.commit()
    log_id = log.id

    await db_session.delete(log)
    await db_session.commit()

    remaining = await db_session.execute(
        select(ExerciseLog).where(ExerciseLog.workout_log_id == log_id)
    )
    assert remaining.scalars().all() == []


async def test_plan_exercise_reps_range_check_constraint(db_session):
    plan = WorkoutPlan(name="Check Constraint Plan")
    plan.exercises.append(
        PlanExercise(
            sort_order=0,
            exercise_name="Invalid Reps",
            target_sets=3,
            target_reps_min=10,
            target_reps_max=5,
        )
    )
    db_session.add(plan)
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_naive_datetime_rejected(db_session):
    from datetime import datetime

    log = WorkoutLog(
        performed_at=datetime(2026, 1, 1),
        total_time_minutes=30,
        overall_feeling=3,
    )
    db_session.add(log)
    with pytest.raises(Exception, match="Naive datetimes"):
        await db_session.commit()
