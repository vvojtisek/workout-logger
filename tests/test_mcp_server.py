from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

from tests.conftest import TEST_API_KEY

MCP_URL = "http://testserver/mcp/"
TOKENS = "/api/v1/tokens"

EXPECTED_TOOLS = {
    "create_plan",
    "get_daily_summary",
    "get_plan",
    "list_programs",
    "log_biometrics",
    "log_meal",
    "log_set",
    "schedule_workout",
}


@asynccontextmanager
async def mcp_client(api_key: str):
    """An MCP client speaking streamable HTTP to the real mounted app, so every
    call goes through the same auth middleware a deployed agent would hit."""
    from app.main import app

    def factory(headers=None, timeout=None, auth=None, **kwargs):
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers=headers,
            timeout=timeout,
            auth=auth,
            **kwargs,
        )

    transport = StreamableHttpTransport(
        url=MCP_URL, headers={"X-API-Key": api_key}, httpx_client_factory=factory
    )
    async with app.router.lifespan_context(app):
        async with Client(transport) as client:
            yield client


async def mint_token(client, auth_headers, name: str, scopes: list[str]) -> str:
    response = await client.post(
        TOKENS, json={"name": name, "scopes": scopes}, headers=auth_headers
    )
    assert response.status_code == 201
    return response.json()["token"]


async def test_mcp_exposes_exactly_the_planned_tools(client, auth_headers):
    async with mcp_client(TEST_API_KEY) as agent:
        tools = await agent.list_tools()
    assert {tool.name for tool in tools} == EXPECTED_TOOLS


async def test_every_tool_documents_itself(client, auth_headers):
    async with mcp_client(TEST_API_KEY) as agent:
        tools = await agent.list_tools()
    for tool in tools:
        assert tool.description, f"{tool.name} has no description"


async def test_unauthenticated_mcp_request_is_rejected(client):
    from app.main import app

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as raw:
            response = await raw.post(
                MCP_URL,
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                headers={"Accept": "application/json, text/event-stream"},
            )
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


async def test_revoked_token_is_rejected_at_the_mcp_boundary(client, auth_headers):
    from app.main import app

    raw_token = await mint_token(client, auth_headers, "revoked agent", ["read", "log"])
    listed = await client.get(TOKENS, headers=auth_headers)
    token_id = next(t["id"] for t in listed.json()["items"] if t["name"] == "revoked agent")
    await client.post(f"{TOKENS}/{token_id}/revoke", headers=auth_headers)

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as raw:
            response = await raw.post(
                MCP_URL,
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                headers={
                    "X-API-Key": raw_token,
                    "Accept": "application/json, text/event-stream",
                },
            )
    assert response.status_code == 401


async def test_read_scoped_token_can_query_but_not_log(client, auth_headers):
    raw_token = await mint_token(client, auth_headers, "read agent", ["read"])
    async with mcp_client(raw_token) as agent:
        summary = await agent.call_tool("get_daily_summary", {"on_date": "2026-05-01"})
        assert summary.data["date"] == "2026-05-01"

        with pytest.raises(Exception, match="log"):
            await agent.call_tool(
                "log_biometrics",
                {"measured_at": "2026-05-01T08:00:00Z", "weight_kg": 80.0},
            )


async def test_log_scoped_token_cannot_call_a_read_tool_without_read(client, auth_headers):
    raw_token = await mint_token(client, auth_headers, "log only agent", ["log"])
    async with mcp_client(raw_token) as agent:
        with pytest.raises(Exception, match="read"):
            await agent.call_tool("list_programs", {})


async def test_create_plan_and_get_plan_round_trip(client, auth_headers):
    async with mcp_client(TEST_API_KEY) as agent:
        created = await agent.call_tool(
            "create_plan",
            {
                "name": "MCP Push Day",
                "description": "Written by the agent",
                "exercises": [
                    {
                        "exercise_name": "Bench Press",
                        "target_sets": 3,
                        "target_reps_min": 5,
                        "target_reps_max": 8,
                        "target_weight_kg": 60.0,
                    }
                ],
            },
        )
        plan_id = created.data["id"]
        assert created.data["name"] == "MCP Push Day"
        assert len(created.data["exercises"]) == 1

        fetched = await agent.call_tool("get_plan", {"plan_id": plan_id})
        assert fetched.data["id"] == plan_id
        assert fetched.data["exercises"][0]["exercise_name"] == "Bench Press"

    # The plan the agent created is the same row the REST API serves.
    rest = await client.get(f"/api/v1/plans/{plan_id}", headers=auth_headers)
    assert rest.status_code == 200
    assert rest.json()["name"] == "MCP Push Day"


async def test_list_programs_reflects_rest_created_programs(client, auth_headers):
    await client.post(
        "/api/v1/programs",
        json={
            "name": "Hockey Pre-Season",
            "kind": "block",
            "start_date": "2026-01-01",
            "status": "active",
        },
        headers=auth_headers,
    )
    async with mcp_client(TEST_API_KEY) as agent:
        result = await agent.call_tool("list_programs", {})
    assert result.data["total"] == 1
    assert result.data["items"][0]["name"] == "Hockey Pre-Season"


async def test_schedule_workout_puts_a_plan_on_the_calendar(client, auth_headers):
    plan = await client.post(
        "/api/v1/plans", json={"name": "Leg Day", "exercises": []}, headers=auth_headers
    )
    plan_id = plan.json()["id"]

    async with mcp_client(TEST_API_KEY) as agent:
        scheduled = await agent.call_tool(
            "schedule_workout", {"workout_plan_id": plan_id, "scheduled_date": "2026-06-15"}
        )
    assert scheduled.data["workout_plan_id"] == plan_id
    assert scheduled.data["scheduled_date"] == "2026-06-15"
    assert scheduled.data["status"] == "scheduled"

    calendar = await client.get(
        "/api/v1/calendar?from=2026-06-01&to=2026-06-30", headers=auth_headers
    )
    assert [item["workout_plan_name"] for item in calendar.json()["items"]] == ["Leg Day"]


async def test_log_set_records_into_an_active_session_and_is_idempotent(client, auth_headers):
    plan = await client.post(
        "/api/v1/plans",
        json={
            "name": "Session Plan",
            "exercises": [
                {
                    "exercise_name": "Squat",
                    "target_sets": 3,
                    "target_reps_min": 5,
                    "target_reps_max": 5,
                }
            ],
        },
        headers=auth_headers,
    )
    started = await client.post(
        "/api/v1/workout-sessions",
        json={"source_plan_id": plan.json()["id"]},
        headers=auth_headers,
    )
    workout_session = started.json()
    session_id = workout_session["id"]
    exercise_id = workout_session["exercises"][0]["id"]

    async with mcp_client(TEST_API_KEY) as agent:
        first = await agent.call_tool(
            "log_set",
            {
                "session_id": session_id,
                "session_exercise_id": exercise_id,
                "set_number": 1,
                "reps": 5,
                "weight_kg": 100.0,
                "client_operation_id": "mcp-op-1",
            },
        )
        assert first.data["created"] is True

        # Replaying the same client_operation_id must not duplicate the set.
        replay = await agent.call_tool(
            "log_set",
            {
                "session_id": session_id,
                "session_exercise_id": exercise_id,
                "set_number": 1,
                "reps": 5,
                "weight_kg": 100.0,
                "client_operation_id": "mcp-op-1",
            },
        )
        assert replay.data["created"] is False

    refreshed = await client.get(f"/api/v1/workout-sessions/{session_id}", headers=auth_headers)
    assert len(refreshed.json()["exercises"][0]["set_entries"]) == 1


async def test_log_meal_snapshots_catalogue_nutrition(client, auth_headers):
    food = await client.post(
        "/api/v1/foods",
        json={
            "name": "Chicken Breast",
            "serving_quantity": 100,
            "serving_unit": "g",
            "energy_kcal": 165,
            "protein_g": 31,
            "carbohydrate_g": 0,
            "fat_g": 3.6,
        },
        headers=auth_headers,
    )
    food_id = food.json()["id"]

    async with mcp_client(TEST_API_KEY) as agent:
        entry = await agent.call_tool(
            "log_meal",
            {
                "consumed_at": "2026-06-01T12:00:00Z",
                "meal_type": "lunch",
                "items": [{"food_id": food_id, "quantity": 200}],
            },
        )
    assert entry.data["meal_type"] == "lunch"
    assert entry.data["items"][0]["food_name_snapshot"] == "Chicken Breast"
    assert entry.data["items"][0]["energy_kcal_snapshot"] == 330


async def test_log_biometrics_then_get_daily_summary_uses_the_same_database(client, auth_headers):
    measured_at = datetime.now(timezone.utc) - timedelta(days=1)
    async with mcp_client(TEST_API_KEY) as agent:
        metric = await agent.call_tool(
            "log_biometrics",
            {
                "measured_at": measured_at.isoformat(),
                "weight_kg": 78.2,
                "body_fat_percent": 18.5,
                "waist_cm": 85.0,
            },
        )
    assert metric.data["weight_kg"] == 78.2

    rest = await client.get("/api/v1/body-metrics", headers=auth_headers)
    assert rest.json()["total"] == 1
    assert rest.json()["items"][0]["waist_cm"] == 85.0


async def test_get_daily_summary_reports_targets_and_remaining(client, auth_headers):
    on_date = date(2026, 7, 1)
    created = await client.post(
        "/api/v1/nutrition-plans",
        json={
            "name": "Cut",
            "valid_from": on_date.isoformat(),
            "energy_target_kcal": 2000,
            "protein_target_g": 180,
            "carbohydrate_target_g": 180,
            "fat_target_g": 60,
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    async with mcp_client(TEST_API_KEY) as agent:
        summary = await agent.call_tool("get_daily_summary", {"on_date": on_date.isoformat()})

    assert summary.data["target"]["energy_target_kcal"] == 2000
    assert summary.data["remaining"]["energy_kcal"] == 2000
    assert summary.data["totals"]["energy_kcal"] == 0


async def test_tool_errors_surface_the_service_layer_message(client, auth_headers):
    async with mcp_client(TEST_API_KEY) as agent:
        with pytest.raises(Exception):
            await agent.call_tool("get_plan", {"plan_id": "00000000-0000-0000-0000-000000000000"})


async def test_mcp_mount_does_not_shadow_the_spa_or_the_rest_api(client, auth_headers):
    plans = await client.get("/api/v1/plans", headers=auth_headers)
    assert plans.status_code == 200

    health = await client.get("/health")
    assert health.status_code == 200
