from datetime import timedelta

import pytest
from sqlalchemy import select
from starlette.exceptions import HTTPException

from app.database import get_session_maker
from app.models import UserSession
from app.models.base import utcnow
from app.security import AuthContext, require_account_admin

INVITES = "/api/v1/invites"
ACCEPT = "/api/v1/auth/invites/accept"
LOGIN = "/api/v1/auth/login"
PLANS = "/api/v1/plans"

PASSWORD = "correct horse battery staple"


async def _create_and_login(client, auth_headers, email: str, role: str = "user") -> None:
    created = await client.post(INVITES, json={"email": email, "role": role}, headers=auth_headers)
    token = created.json()["token"]
    await client.post(ACCEPT, json={"token": token, "password": PASSWORD})
    login_response = await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    assert login_response.status_code == 200


async def test_session_cookie_alone_authenticates_a_data_route(client, auth_headers):
    await _create_and_login(client, auth_headers, "session.reader@example.test")
    response = await client.get(PLANS)
    assert response.status_code == 200


async def test_expired_session_cookie_is_rejected(client, auth_headers, app_engine):
    await _create_and_login(client, auth_headers, "session.expired@example.test")
    assert (await client.get(PLANS)).status_code == 200

    session_maker = get_session_maker()
    async with session_maker() as session:
        result = await session.execute(select(UserSession))
        user_session = result.scalar_one()
        user_session.expires_at = utcnow() - timedelta(minutes=1)
        await session.commit()

    assert (await client.get(PLANS)).status_code == 401


async def test_session_non_admin_cannot_create_invite(client, auth_headers):
    await _create_and_login(client, auth_headers, "session.nonadmin@example.test", role="user")
    response = await client.post(
        INVITES, json={"email": "someone.else@example.test", "role": "user"}
    )
    assert response.status_code == 403


async def test_session_admin_can_create_invite(client, auth_headers):
    await _create_and_login(client, auth_headers, "session.admin@example.test", role="admin")
    response = await client.post(
        INVITES, json={"email": "someone.new@example.test", "role": "user"}
    )
    assert response.status_code == 201


async def test_require_account_admin_rejects_token_scope_admin_without_a_user():
    """Regression guard: `has_scope("admin")` being satisfied (bootstrap API_KEY
    or an admin-scoped ApiToken) must NOT satisfy `require_account_admin` --
    only a real, session-authenticated account admin should. This is what
    keeps the two admin concepts (token scope vs. account role) from
    silently collapsing into each other."""
    token_scope_admin = AuthContext(scopes={"admin"}, token=None)
    with pytest.raises(HTTPException) as exc_info:
        await require_account_admin(token_scope_admin)
    assert exc_info.value.status_code == 403


async def test_require_account_admin_rejects_session_user_role():
    session_user = AuthContext(scopes={"read", "log"}, token=None, user=_FakeUser("user"))
    with pytest.raises(HTTPException) as exc_info:
        await require_account_admin(session_user)
    assert exc_info.value.status_code == 403


async def test_require_account_admin_accepts_session_admin_role():
    session_admin = AuthContext(scopes={"read", "log"}, token=None, user=_FakeUser("admin"))
    result = await require_account_admin(session_admin)
    assert result is session_admin


class _FakeUser:
    def __init__(self, role: str) -> None:
        self.role = role
