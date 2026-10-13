import asyncio
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.database import get_session_maker
from app.models import AccountToken, User
from app.models.base import utcnow
from scripts.create_first_admin import create_first_admin

BASE = "/api/v1/invites"
ACCEPT = "/api/v1/auth/invites/accept"
TOKENS = "/api/v1/tokens"


def make_invite_payload(**overrides) -> dict:
    payload = {"email": "new.person@example.test", "role": "user"}
    payload.update(overrides)
    return payload


async def test_create_invite_returns_raw_token_once(client, auth_headers):
    response = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["token"].startswith("inv_")
    assert body["email"] == "new.person@example.test"
    assert body["role"] == "user"
    assert body["status"] == "pending"
    assert "Location" in response.headers


async def test_invite_email_is_normalized(client, auth_headers):
    response = await client.post(
        BASE, json=make_invite_payload(email="  Mixed.Case@Example.TEST "), headers=auth_headers
    )
    assert response.status_code == 201
    assert response.json()["email"] == "mixed.case@example.test"


async def test_list_invites_never_returns_raw_token(client, auth_headers):
    await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert all("token" not in item for item in body["items"])


async def test_duplicate_pending_invite_for_same_email_is_rejected(client, auth_headers):
    await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    response = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    assert response.status_code == 409


async def test_invite_for_existing_user_email_is_rejected(client, auth_headers):
    created = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    token = created.json()["token"]
    await client.post(ACCEPT, json={"token": token, "password": "correct horse battery staple"})

    response = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    assert response.status_code == 409


async def test_get_missing_invite_returns_404(client, auth_headers):
    response = await client.get(
        f"{BASE}/00000000-0000-0000-0000-000000000000", headers=auth_headers
    )
    assert response.status_code == 404


async def test_invites_router_requires_admin(client):
    response = await client.get(BASE)
    assert response.status_code == 401


async def test_non_admin_token_cannot_create_invite(client, auth_headers):
    token_resp = await client.post(
        TOKENS, json={"name": "logger", "scopes": ["read", "log"]}, headers=auth_headers
    )
    minted_key = token_resp.json()["token"]
    response = await client.post(
        BASE,
        json=make_invite_payload(email="other@example.test"),
        headers={"X-API-Key": minted_key},
    )
    assert response.status_code == 403


async def test_revoke_invite_is_idempotent(client, auth_headers):
    created = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    invite_id = created.json()["id"]
    first = await client.post(f"{BASE}/{invite_id}/revoke", headers=auth_headers)
    second = await client.post(f"{BASE}/{invite_id}/revoke", headers=auth_headers)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["revoked_at"] == second.json()["revoked_at"]
    assert first.json()["status"] == "revoked"


# --- accept-invite ---


async def test_accept_invite_creates_user_with_hashed_password(client, auth_headers):
    created = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    token = created.json()["token"]

    response = await client.post(
        ACCEPT, json={"token": token, "password": "correct horse battery staple"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "new.person@example.test"
    assert body["role"] == "user"
    assert "password" not in body
    assert "password_hash" not in body


async def test_invite_cannot_grant_another_admin(client, auth_headers):
    response = await client.post(BASE, json=make_invite_payload(role="admin"), headers=auth_headers)
    assert response.status_code == 422


async def test_accept_invite_twice_is_rejected(client, auth_headers):
    created = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    token = created.json()["token"]
    first = await client.post(
        ACCEPT, json={"token": token, "password": "correct horse battery staple"}
    )
    assert first.status_code == 201

    second = await client.post(ACCEPT, json={"token": token, "password": "another password value"})
    assert second.status_code == 409


async def test_accept_revoked_invite_is_rejected(client, auth_headers):
    created = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    invite_id = created.json()["id"]
    token = created.json()["token"]
    await client.post(f"{BASE}/{invite_id}/revoke", headers=auth_headers)

    response = await client.post(
        ACCEPT, json={"token": token, "password": "correct horse battery staple"}
    )
    assert response.status_code == 409


async def test_accept_expired_invite_returns_409(client, auth_headers, app_engine):
    created = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    invite_id = created.json()["id"]
    token = created.json()["token"]

    session_maker = get_session_maker()
    async with session_maker() as session:
        account_token = await session.get(AccountToken, invite_id)
        account_token.expires_at = utcnow() - timedelta(hours=1)
        await session.commit()

    response = await client.post(
        ACCEPT, json={"token": token, "password": "correct horse battery staple"}
    )
    assert response.status_code == 409


async def test_accept_invite_with_garbage_token_returns_404(client):
    response = await client.post(
        ACCEPT, json={"token": "not-a-real-token", "password": "correct horse battery staple"}
    )
    assert response.status_code == 404


async def test_accept_invite_with_short_password_returns_422(client, auth_headers):
    created = await client.post(BASE, json=make_invite_payload(), headers=auth_headers)
    token = created.json()["token"]
    response = await client.post(ACCEPT, json={"token": token, "password": "short"})
    assert response.status_code == 422


async def test_invites_enforce_one_admin_and_ten_user_capacity(client, auth_headers, app_engine):
    test_run_id = uuid4().hex
    email_prefix = f"[TEST_RUN_ID:{test_run_id}]"
    admin_email = f"admin-{test_run_id}@example.test"
    invite_ids = []
    invite_tokens = []
    try:
        await create_first_admin(admin_email, "correct horse battery staple")
        for index in range(10):
            response = await client.post(
                BASE,
                json=make_invite_payload(
                    email=f"{email_prefix}-user-{index}@example.test",
                ),
                headers=auth_headers,
            )
            assert response.status_code == 201
            invite_ids.append(response.json()["id"])
            invite_tokens.append(response.json()["token"])

        admin_invite = await client.post(
            BASE,
            json=make_invite_payload(
                email=f"{email_prefix}-extra-admin@example.test",
                role="admin",
            ),
            headers=auth_headers,
        )
        assert admin_invite.status_code == 422

        accepted = await client.post(
            ACCEPT,
            json={"token": invite_tokens[0], "password": "correct horse battery staple"},
        )
        assert accepted.status_code == 201

        overflow = await client.post(
            BASE,
            json=make_invite_payload(email=f"{email_prefix}-overflow@example.test"),
            headers=auth_headers,
        )
        assert overflow.status_code == 409
        assert overflow.json()["code"] == "USER_CAPACITY_REACHED"

        revoked = await client.post(
            f"{BASE}/{invite_ids[1]}/revoke",
            headers=auth_headers,
        )
        assert revoked.status_code == 200
        replacement = await client.post(
            BASE,
            json=make_invite_payload(email=f"{email_prefix}-replacement@example.test"),
            headers=auth_headers,
        )
        assert replacement.status_code == 201
        invite_ids.append(replacement.json()["id"])
    finally:
        async with app_engine.begin() as connection:
            await connection.execute(
                delete(AccountToken).where(AccountToken.email.like(f"{email_prefix}%"))
            )
            await connection.execute(delete(User).where(User.email == admin_email))
            await connection.execute(delete(User).where(User.email.like(f"{email_prefix}%")))

        async with app_engine.connect() as connection:
            leftover_tokens = await connection.scalar(
                select(func.count())
                .select_from(AccountToken)
                .where(AccountToken.email.like(f"{email_prefix}%"))
            )
            leftover_users = await connection.scalar(
                select(func.count())
                .select_from(User)
                .where((User.email == admin_email) | User.email.like(f"{email_prefix}%"))
            )
        assert leftover_tokens == 0
        assert leftover_users == 0


async def test_concurrent_invites_never_exceed_ten_user_capacity(client, auth_headers, app_engine):
    test_run_id = uuid4().hex
    email_prefix = f"[TEST_RUN_ID:{test_run_id}]"
    responses = []
    try:
        responses = await asyncio.gather(
            *(
                client.post(
                    BASE,
                    json=make_invite_payload(email=f"{email_prefix}-{index}@example.test"),
                    headers=auth_headers,
                )
                for index in range(11)
            )
        )

        assert sum(response.status_code == 201 for response in responses) == 10
        rejected = [response for response in responses if response.status_code == 409]
        assert len(rejected) == 1
        assert rejected[0].json()["code"] == "USER_CAPACITY_REACHED"

        async with app_engine.connect() as connection:
            persisted_invites = await connection.scalar(
                select(func.count())
                .select_from(AccountToken)
                .where(
                    AccountToken.email.like(f"{email_prefix}%"),
                    AccountToken.revoked_at.is_(None),
                    AccountToken.used_at.is_(None),
                )
            )
        assert persisted_invites == 10
    finally:
        async with app_engine.begin() as connection:
            await connection.execute(
                delete(AccountToken).where(AccountToken.email.like(f"{email_prefix}%"))
            )
        async with app_engine.connect() as connection:
            leftover_tokens = await connection.scalar(
                select(func.count())
                .select_from(AccountToken)
                .where(AccountToken.email.like(f"{email_prefix}%"))
            )
        assert leftover_tokens == 0
