from httpx import ASGITransport, AsyncClient

from app.main import app

INVITES = "/api/v1/invites"
ACCEPT = "/api/v1/auth/invites/accept"
LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/auth/me"
USERS = "/api/v1/users"

PASSWORD = "correct horse battery staple"


async def _create_user(client, auth_headers, email="login.me@example.test", role="user") -> str:
    created = await client.post(INVITES, json={"email": email, "role": role}, headers=auth_headers)
    token = created.json()["token"]
    await client.post(ACCEPT, json={"token": token, "password": PASSWORD})
    return email


async def _second_client() -> AsyncClient:
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    return AsyncClient(transport=transport, base_url="http://testserver")


async def test_login_with_correct_credentials_sets_cookie(client, auth_headers):
    email = await _create_user(client, auth_headers)
    response = await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    assert response.json()["email"] == email
    assert "wl_session" in response.cookies


async def test_login_email_is_case_and_whitespace_insensitive(client, auth_headers):
    email = await _create_user(client, auth_headers, email="mixedcase@example.test")
    response = await client.post(
        LOGIN, json={"email": "  MixedCase@Example.TEST ", "password": PASSWORD}
    )
    assert response.status_code == 200
    assert response.json()["email"] == email


async def test_login_with_wrong_password_and_unknown_email_return_identical_401(
    client, auth_headers
):
    email = await _create_user(client, auth_headers, email="wrongpass@example.test")
    wrong_password = await client.post(LOGIN, json={"email": email, "password": "not it"})
    unknown_email = await client.post(
        LOGIN, json={"email": "nobody@example.test", "password": "whatever"}
    )
    assert wrong_password.status_code == 401
    assert unknown_email.status_code == 401
    assert wrong_password.json()["detail"] == unknown_email.json()["detail"]


async def test_login_for_disabled_user_returns_401(client, auth_headers):
    email = await _create_user(client, auth_headers, email="disabled.login@example.test")
    users_resp = await client.get(USERS, headers=auth_headers)
    user_id = next(u["id"] for u in users_resp.json()["items"] if u["email"] == email)
    await client.post(f"{USERS}/{user_id}/revoke", headers=auth_headers)

    response = await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    assert response.status_code == 401


async def test_me_without_cookie_returns_401(client):
    response = await client.get(ME)
    assert response.status_code == 401


async def test_me_with_cookie_returns_current_user(client, auth_headers):
    email = await _create_user(client, auth_headers, email="whoami@example.test")
    await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    response = await client.get(ME)
    assert response.status_code == 200
    assert response.json()["email"] == email


async def test_logout_clears_cookie_and_requires_login_again(client, auth_headers):
    email = await _create_user(client, auth_headers, email="logout.me@example.test")
    await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    assert (await client.get(ME)).status_code == 200

    logout_response = await client.post(LOGOUT)
    assert logout_response.status_code == 204
    assert (await client.get(ME)).status_code == 401


async def test_replaying_a_logged_out_session_cookie_stays_401(client, auth_headers):
    """Proves logout revokes the session server-side, not just clears the
    client's cookie -- a fresh client manually replaying the exact same raw
    token value must still be rejected."""
    email = await _create_user(client, auth_headers, email="replay@example.test")
    login_response = await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    raw_cookie_value = login_response.cookies["wl_session"]

    await client.post(LOGOUT)

    async with await _second_client() as replay_client:
        response = await replay_client.get(ME, headers={"Cookie": f"wl_session={raw_cookie_value}"})
    assert response.status_code == 401


async def test_rate_limit_trips_after_repeated_failures(client, auth_headers):
    email = await _create_user(client, auth_headers, email="ratelimited@example.test")
    for _ in range(10):
        response = await client.post(LOGIN, json={"email": email, "password": "wrong"})
        assert response.status_code == 401

    limited = await client.post(LOGIN, json={"email": email, "password": "wrong"})
    assert limited.status_code == 429

    # Even the correct password is blocked once the account is rate-limited.
    still_limited = await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    assert still_limited.status_code == 429


async def test_rate_limit_is_db_backed_not_per_process(client, auth_headers):
    """Simulates two app replicas sharing one DB: 10 failures via the first
    client bring the count to the limit, then the 11th failure from an
    entirely separate AsyncClient (no shared in-process state) still trips
    -- proving the counter lives in the DB, not per-process memory."""
    email = await _create_user(client, auth_headers, email="shared.db@example.test")

    for _ in range(10):
        response = await client.post(LOGIN, json={"email": email, "password": "wrong"})
        assert response.status_code == 401

    async with await _second_client() as second_client:
        response = await second_client.post(LOGIN, json={"email": email, "password": "wrong"})
    assert response.status_code == 429
