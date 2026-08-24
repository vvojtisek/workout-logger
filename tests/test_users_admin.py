BASE = "/api/v1/users"
INVITES = "/api/v1/invites"
ACCEPT = "/api/v1/auth/invites/accept"


async def _create_user(client, auth_headers, email="person@example.test", role="user") -> dict:
    created = await client.post(INVITES, json={"email": email, "role": role}, headers=auth_headers)
    token = created.json()["token"]
    response = await client.post(
        ACCEPT, json={"token": token, "password": "correct horse battery staple"}
    )
    return response.json()


async def test_list_users_never_returns_password_hash(client, auth_headers):
    await _create_user(client, auth_headers)
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert all("password_hash" not in item and "password" not in item for item in body["items"])


async def test_get_missing_user_returns_404(client, auth_headers):
    response = await client.get(
        f"{BASE}/00000000-0000-0000-0000-000000000000", headers=auth_headers
    )
    assert response.status_code == 404


async def test_revoke_user_sets_disabled_at_and_is_idempotent(client, auth_headers):
    user = await _create_user(client, auth_headers, email="disable.me@example.test")
    first = await client.post(f"{BASE}/{user['id']}/revoke", headers=auth_headers)
    second = await client.post(f"{BASE}/{user['id']}/revoke", headers=auth_headers)
    assert first.status_code == 200
    assert first.json()["disabled_at"] is not None
    assert first.json()["disabled_at"] == second.json()["disabled_at"]


async def test_reset_password_issues_single_use_token(client, auth_headers):
    user = await _create_user(client, auth_headers, email="reset.me@example.test")
    response = await client.post(f"{BASE}/{user['id']}/reset-password", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["token"].startswith("rst_")
    assert "expires_at" in body


async def test_reset_password_for_missing_user_returns_404(client, auth_headers):
    response = await client.post(
        f"{BASE}/00000000-0000-0000-0000-000000000000/reset-password", headers=auth_headers
    )
    assert response.status_code == 404


async def test_users_router_requires_admin(client):
    response = await client.get(BASE)
    assert response.status_code == 401
