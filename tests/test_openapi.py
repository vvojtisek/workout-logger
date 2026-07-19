async def test_openapi_has_api_key_security_scheme(client):
    response = await client.get("/openapi.json")
    spec = response.json()
    schemes = spec["components"]["securitySchemes"]
    assert "APIKeyHeader" in schemes
    scheme = schemes["APIKeyHeader"]
    assert scheme["type"] == "apiKey"
    assert scheme["in"] == "header"
    assert scheme["name"] == "X-API-Key"


async def test_openapi_includes_public_server_url(client):
    response = await client.get("/openapi.json")
    spec = response.json()
    assert spec["servers"] == [{"url": "https://fitness.example.test"}]


async def test_protected_operations_require_security(client):
    response = await client.get("/openapi.json")
    spec = response.json()
    plans_get = spec["paths"]["/api/v1/plans"]["get"]
    assert plans_get.get("security"), "Protected operation must declare a security requirement"


async def test_public_operations_have_no_security(client):
    response = await client.get("/openapi.json")
    spec = response.json()
    health_get = spec["paths"]["/health"]["get"]
    assert not health_get.get("security")


async def test_health_operation_has_response_schema(client):
    response = await client.get("/openapi.json")
    spec = response.json()
    health_get = spec["paths"]["/health"]["get"]
    assert health_get["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/HealthResponse"
    }


async def test_plans_list_operation_id_is_stable(client):
    response = await client.get("/openapi.json")
    spec = response.json()
    plans_get = spec["paths"]["/api/v1/plans"]["get"]
    assert plans_get["operationId"] == "list_workout_plans"


async def test_logs_list_operation_id_is_stable(client):
    response = await client.get("/openapi.json")
    spec = response.json()
    logs_get = spec["paths"]["/api/v1/logs"]["get"]
    assert logs_get["operationId"] == "list_workout_logs"
