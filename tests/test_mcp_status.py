BASE = "/api/v1/mcp-status"


def test_disabled_mcp_has_no_public_transport_or_discovery_routes():
    from fastapi import FastAPI

    from app.main import register_mcp_routes

    app = FastAPI()
    register_mcp_routes(app, FastAPI(), auth=object(), enabled=False)
    route_paths = {route.path for route in app.routes}

    assert "/mcp" not in route_paths
    assert "/.well-known/oauth-protected-resource" not in route_paths


async def test_mcp_status_reports_enabled_and_the_full_tool_set(client, auth_headers):
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert body["path"] == "/mcp"
    assert body["tool_count"] == 10
    assert len(body["tools"]) == 10
    names = {tool["name"] for tool in body["tools"]}
    assert names == {
        "list_programs",
        "get_plan",
        "get_progression_rules",
        "get_coaching_principles",
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
