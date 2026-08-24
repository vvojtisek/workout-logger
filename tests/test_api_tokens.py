BASE = "/api/v1/tokens"
PROTECTED_PATH = "/api/v1/plans"


def make_token_payload(**overrides) -> dict:
    payload = {"name": "MCP agent", "scopes": ["read", "log"]}
    payload.update(overrides)
    return payload


async def test_create_token_returns_raw_secret_once(client, auth_headers):
    response = await client.post(BASE, json=make_token_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["token"].startswith("wl_")
    assert body["token_prefix"] == body["token"][:10]
    assert body["scopes"] == ["read", "log"]
    assert body["revoked_at"] is None
    assert body["last_used_at"] is None
    assert "Location" in response.headers


async def test_list_tokens_never_returns_raw_secret(client, auth_headers):
    await client.post(BASE, json=make_token_payload(), headers=auth_headers)
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert all("token" not in item for item in body["items"])


async def test_scopes_are_deduplicated_and_order_normalized(client, auth_headers):
    response = await client.post(
        BASE, json=make_token_payload(scopes=["log", "read", "log"]), headers=auth_headers
    )
    assert response.status_code == 201
    assert response.json()["scopes"] == ["read", "log"]


async def test_create_token_with_empty_scopes_returns_422(client, auth_headers):
    response = await client.post(BASE, json=make_token_payload(scopes=[]), headers=auth_headers)
    assert response.status_code == 422


async def test_create_token_with_invalid_scope_returns_422(client, auth_headers):
    response = await client.post(
        BASE, json=make_token_payload(scopes=["superuser"]), headers=auth_headers
    )
    assert response.status_code == 422


async def test_get_missing_token_returns_404(client, auth_headers):
    response = await client.get(
        f"{BASE}/00000000-0000-0000-0000-000000000000", headers=auth_headers
    )
    assert response.status_code == 404


async def test_tokens_router_requires_admin_scope_even_for_reads(client, auth_headers):
    created = await client.post(
        BASE, json=make_token_payload(name="read-only", scopes=["read"]), headers=auth_headers
    )
    read_only_key = created.json()["token"]

    response = await client.get(BASE, headers={"X-API-Key": read_only_key})
    assert response.status_code == 403


async def test_minted_token_authenticates_against_its_scope(client, auth_headers):
    created = await client.post(
        BASE,
        json=make_token_payload(name="log agent", scopes=["read", "log"]),
        headers=auth_headers,
    )
    minted_key = created.json()["token"]
    headers = {"X-API-Key": minted_key}

    read_response = await client.get(PROTECTED_PATH, headers=headers)
    assert read_response.status_code == 200

    write_response = await client.post(
        PROTECTED_PATH, json={"name": "Minted plan", "exercises": []}, headers=headers
    )
    assert write_response.status_code == 201


async def test_read_only_token_cannot_write(client, auth_headers):
    created = await client.post(
        BASE, json=make_token_payload(name="read-only", scopes=["read"]), headers=auth_headers
    )
    minted_key = created.json()["token"]
    headers = {"X-API-Key": minted_key}

    read_response = await client.get(PROTECTED_PATH, headers=headers)
    assert read_response.status_code == 200

    write_response = await client.post(
        PROTECTED_PATH, json={"name": "Should be blocked", "exercises": []}, headers=headers
    )
    assert write_response.status_code == 403


async def test_log_scoped_token_cannot_manage_other_tokens(client, auth_headers):
    created = await client.post(
        BASE,
        json=make_token_payload(name="log agent", scopes=["read", "log"]),
        headers=auth_headers,
    )
    minted_key = created.json()["token"]

    response = await client.post(
        BASE, json=make_token_payload(name="escalation attempt"), headers={"X-API-Key": minted_key}
    )
    assert response.status_code == 403


async def test_unknown_token_returns_401(client):
    response = await client.get(PROTECTED_PATH, headers={"X-API-Key": "wl_not-a-real-token"})
    assert response.status_code == 401


async def test_revoked_token_returns_401(client, auth_headers):
    created = await client.post(BASE, json=make_token_payload(), headers=auth_headers)
    body = created.json()
    minted_key = body["token"]
    token_id = body["id"]

    revoke_response = await client.post(f"{BASE}/{token_id}/revoke", headers=auth_headers)
    assert revoke_response.status_code == 200
    assert revoke_response.json()["revoked_at"] is not None

    response = await client.get(PROTECTED_PATH, headers={"X-API-Key": minted_key})
    assert response.status_code == 401


async def test_revoking_twice_keeps_original_revoked_at(client, auth_headers):
    created = await client.post(BASE, json=make_token_payload(), headers=auth_headers)
    token_id = created.json()["id"]

    first = await client.post(f"{BASE}/{token_id}/revoke", headers=auth_headers)
    second = await client.post(f"{BASE}/{token_id}/revoke", headers=auth_headers)
    assert first.json()["revoked_at"] == second.json()["revoked_at"]


async def test_using_a_token_updates_last_used_at(client, auth_headers):
    created = await client.post(BASE, json=make_token_payload(), headers=auth_headers)
    body = created.json()
    minted_key = body["token"]
    token_id = body["id"]
    assert body["last_used_at"] is None

    await client.get(PROTECTED_PATH, headers={"X-API-Key": minted_key})

    refreshed = await client.get(f"{BASE}/{token_id}", headers=auth_headers)
    assert refreshed.json()["last_used_at"] is not None


async def test_bootstrap_api_key_still_has_full_access(client, auth_headers):
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    response = await client.post(
        PROTECTED_PATH, json={"name": "Bootstrap plan", "exercises": []}, headers=auth_headers
    )
    assert response.status_code == 201
