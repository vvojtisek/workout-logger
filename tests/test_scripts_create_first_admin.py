import pytest
from sqlalchemy import select

from app.database import get_session_maker
from app.models import User
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
