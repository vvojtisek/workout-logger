PROTECTED_PATH = "/api/v1/plans"


async def test_health_accessible_without_key(client):
    response = await client.get("/health")
    assert response.status_code == 200


async def test_docs_accessible_without_key(client):
    response = await client.get("/docs")
    assert response.status_code == 200


async def test_openapi_json_accessible_without_key(client):
    response = await client.get("/openapi.json")
    assert response.status_code == 200


async def test_protected_endpoint_without_key_returns_401(client):
    response = await client.get(PROTECTED_PATH)
    assert response.status_code == 401


async def test_protected_endpoint_with_empty_key_returns_401(client):
    response = await client.get(PROTECTED_PATH, headers={"X-API-Key": ""})
    assert response.status_code == 401


async def test_protected_endpoint_with_wrong_key_returns_401(client):
    response = await client.get(PROTECTED_PATH, headers={"X-API-Key": "wrong" * 8})
    assert response.status_code == 401


async def test_protected_endpoint_with_correct_key_succeeds(client, auth_headers):
    response = await client.get(PROTECTED_PATH, headers=auth_headers)
    assert response.status_code == 200


async def test_action_alias_without_key_returns_401(client):
    response = await client.get("/workout-plans")
    assert response.status_code == 401


async def test_action_alias_with_correct_key_succeeds(client, auth_headers):
    response = await client.get("/workout-plans", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["items"] == []


async def test_401_response_has_standard_error_shape(client):
    response = await client.get(PROTECTED_PATH)
    body = response.json()
    assert set(body.keys()) == {"detail", "code", "request_id"}
    assert body["code"] == "UNAUTHORIZED"
