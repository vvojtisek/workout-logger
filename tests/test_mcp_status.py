BASE = "/api/v1/mcp-status"


async def test_mcp_status_reports_enabled_and_the_full_tool_set(client, auth_headers):
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert body["path"] == "/mcp"
    assert body["tool_count"] == 8
    assert len(body["tools"]) == 8
    names = {tool["name"] for tool in body["tools"]}
    assert names == {
        "list_programs",
        "get_plan",
        "create_plan",
        "schedule_workout",
        "log_set",
        "log_meal",
        "log_biometrics",
        "get_daily_summary",
    }
    assert all(tool["description"] for tool in body["tools"])


async def test_mcp_status_requires_authentication(client):
    response = await client.get(BASE)
    assert response.status_code == 401


async def test_mcp_status_is_read_only_for_a_read_scoped_token(client, auth_headers):
    created = await client.post(
        "/api/v1/tokens",
        json={"name": "read-only", "scopes": ["read"]},
        headers=auth_headers,
    )
    read_only_key = created.json()["token"]
    response = await client.get(BASE, headers={"X-API-Key": read_only_key})
    assert response.status_code == 200
