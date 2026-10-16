from app.schemas.coaching_principles import MAX_PRINCIPLES_LENGTH
from scripts.create_first_admin import create_first_admin

BASE = "/api/v1/coaching-principles"
INVITES = "/api/v1/invites"
ACCEPT = "/api/v1/auth/invites/accept"
LOGIN = "/api/v1/auth/login"
PASSWORD = "correct horse battery staple"


async def _login_as_user(client, auth_headers, email: str) -> None:
    created = await client.post(
        INVITES, json={"email": email, "role": "user"}, headers=auth_headers
    )
    await client.post(ACCEPT, json={"token": created.json()["token"], "password": PASSWORD})
    response = await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    assert response.status_code == 200


async def test_principles_start_empty(client, auth_headers):
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {"body": "", "updated_at": None}


async def test_admin_replaces_the_principles_and_reads_them_back(client, auth_headers):
    text = "# Strength\n- Two full-body sessions a week.\n- No heavy legs the day before hockey."
    saved = await client.put(BASE, json={"body": text}, headers=auth_headers)
    assert saved.status_code == 200
    assert saved.json()["body"] == text
    assert saved.json()["updated_at"] is not None

    replaced = await client.put(BASE, json={"body": "Sleep comes first."}, headers=auth_headers)
    assert replaced.json()["body"] == "Sleep comes first."
    fetched = await client.get(BASE, headers=auth_headers)
    assert fetched.json()["body"] == "Sleep comes first."


async def test_a_signed_in_user_can_read_but_not_edit(client, auth_headers):
    await client.put(BASE, json={"body": "Evidence first."}, headers=auth_headers)
    await _login_as_user(client, auth_headers, "principles.user@example.test")

    assert (await client.get(BASE)).json()["body"] == "Evidence first."
    response = await client.put(BASE, json={"body": "Fads welcome."})
    assert response.status_code == 403
    assert (await client.get(BASE)).json()["body"] == "Evidence first."


async def test_a_signed_in_admin_can_edit(client):
    email = "principles.admin@example.test"
    await create_first_admin(email, PASSWORD)
    assert (
        await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    ).status_code == 200
    response = await client.put(BASE, json={"body": "Admin edit."})
    assert response.status_code == 200
    assert response.json()["body"] == "Admin edit."


async def test_a_log_scoped_token_cannot_edit(client, auth_headers):
    created = await client.post(
        "/api/v1/tokens",
        json={"name": "agent", "scopes": ["read", "log"]},
        headers=auth_headers,
    )
    headers = {"X-API-Key": created.json()["token"]}
    assert (await client.get(BASE, headers=headers)).status_code == 200
    response = await client.put(BASE, json={"body": "From an agent."}, headers=headers)
    assert response.status_code == 403


async def test_principles_have_a_length_limit(client, auth_headers):
    too_long = "x" * (MAX_PRINCIPLES_LENGTH + 1)
    response = await client.put(BASE, json={"body": too_long}, headers=auth_headers)
    assert response.status_code == 422
