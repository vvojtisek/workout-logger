import uuid

import pytest
from sqlalchemy import select

from app.database import get_session_maker
from app.models import User, WorkoutPlan
from scripts.create_first_admin import create_first_admin


async def test_creates_first_admin(app_engine):
    email = await create_first_admin("First.Admin@Example.TEST", "correct horse battery staple")
    assert email == "first.admin@example.test"

    session_maker = get_session_maker()
    async with session_maker() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one()
        assert user.role == "admin"
        assert user.password_hash != "correct horse battery staple"


async def test_refuses_when_a_user_already_exists(app_engine):
    await create_first_admin("first@example.test", "correct horse battery staple")
    with pytest.raises(SystemExit):
        await create_first_admin("second@example.test", "another password value")


async def test_first_admin_claims_legacy_unowned_personal_data(app_engine):
    test_run_id = uuid.uuid4().hex
    session_maker = get_session_maker()
    async with session_maker() as session:
        legacy_plan = WorkoutPlan(
            name=f"Legacy plan {test_run_id}",
            description=f"[TEST_RUN_ID:{test_run_id}]",
        )
        session.add(legacy_plan)
        await session.commit()
        plan_id = legacy_plan.id

    await create_first_admin(f"admin-{test_run_id}@example.test", "correct horse battery staple")

    async with session_maker() as session:
        plan = await session.scalar(select(WorkoutPlan).where(WorkoutPlan.id == plan_id))
        assert plan is not None
        assert plan.owner_id is not None
        await session.delete(plan)
        await session.commit()
        remaining = await session.scalar(select(WorkoutPlan).where(WorkoutPlan.id == plan_id))
    assert remaining is None
