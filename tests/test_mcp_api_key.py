"""MCP with the app's own API tokens (`wl_...`) beside OAuth: Bearer and
X-API-Key headers, scope mapping, owner scoping, and the coach-loop tools
over real streamable HTTP against the mounted app."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime

import httpx
import pytest
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from fastmcp.exceptions import ToolError

from app.config import Settings
from app.database import get_session_maker
from app.mcp.api_key_auth import ApiKeyOrOAuthAuth
from app.mcp.oauth import build_mcp_auth
from app.models import ApiToken
from app.services.api_tokens import _generate_raw_token
from app.token_hash import hash_token
from tests.conftest import TEST_API_KEY, mint_mcp_oauth_token
from tests.test_account_data_isolation import _create_logged_in_user
from tests.test_mcp_server import EXPECTED_TOOLS, MCP_URL

TODAY = datetime.now(UTC).date()


@asynccontextmanager
async def mcp_with_headers(headers: dict[str, str]):
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

    transport = StreamableHttpTransport(url=MCP_URL, headers=headers, httpx_client_factory=factory)
    async with app.router.lifespan_context(app), Client(transport) as client:
        yield client


async def _token(client, auth_headers, scopes: list[str]) -> str:
    response = await client.post(
        "/api/v1/tokens", json={"name": "Claude Code", "scopes": scopes}, headers=auth_headers
    )
    assert response.status_code == 201, response.text
    return response.json()["token"]


async def _owned_token(owner_id) -> str:
    raw = _generate_raw_token()
    async with get_session_maker()() as session:
        session.add(
            ApiToken(
                owner_id=owner_id,
                name="Gemini CLI",
                token_hash=hash_token(raw),
                token_prefix=raw[:8],
                scopes="read,log",
            )
        )
        await session.commit()
    return raw


async def _raw_post(headers: dict[str, str]) -> httpx.Response:
    from app.main import app

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as raw:
            return await raw.post(
                MCP_URL,
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                headers={"Accept": "application/json, text/event-stream", **headers},
            )


def _day_plan() -> dict:
    return {
        "plan_date": TODAY.isoformat(),
        "energy_target_kcal": 2300,
        "protein_target_g": 150,
        "meals": [
            {
                "meal_type": "lunch",
                "name": "Turkey rice bowl",
                "energy_kcal": 650,
                "protein_g": 50,
                "carbohydrate_g": 75,
                "fat_g": 14,
                "prep_steps": ["Cook rice", "Pan-fry turkey"],
                "ingredients": [
                    {"name": "Turkey breast", "quantity": 180, "unit": "g"},
                    {"name": "Rice", "quantity": 90, "unit": "g"},
                ],
            }
        ],
    }


async def test_api_token_as_bearer_sees_every_tool(client, auth_headers):
    token = await _token(client, auth_headers, ["read", "log"])
    async with mcp_with_headers({"Authorization": f"Bearer {token}"}) as agent:
        tools = {tool.name for tool in await agent.list_tools()}
    assert tools == EXPECTED_TOOLS


async def test_api_token_in_x_api_key_header_works(client, auth_headers):
    token = await _token(client, auth_headers, ["read"])
    async with mcp_with_headers({"X-API-Key": token}) as agent:
        result = await agent.call_tool("get_coaching_context", {"days": 3})
    assert result.data["window"]["days"] == 3


async def test_bootstrap_key_and_revoked_tokens_are_refused(client, auth_headers):
    assert (await _raw_post({"X-API-Key": TEST_API_KEY})).status_code == 401
    assert (await _raw_post({"Authorization": f"Bearer {TEST_API_KEY}"})).status_code == 401

    token = await _token(client, auth_headers, ["read", "log"])
    tokens = await client.get("/api/v1/tokens", headers=auth_headers)
    token_id = tokens.json()["items"][0]["id"]
    revoked = await client.post(f"/api/v1/tokens/{token_id}/revoke", headers=auth_headers)
    assert revoked.status_code in (200, 204)
    assert (await _raw_post({"Authorization": f"Bearer {token}"})).status_code == 401
    assert (await _raw_post({"Authorization": "Bearer wl_not-a-real-token"})).status_code == 401


async def test_read_only_token_cannot_write(client, auth_headers):
    token = await _token(client, auth_headers, ["read"])
    async with mcp_with_headers({"Authorization": f"Bearer {token}"}) as agent:
        tools = {tool.name for tool in await agent.list_tools()}
        assert "upsert_daily_nutrition_plan" not in tools
        with pytest.raises(ToolError):
            await agent.call_tool("upsert_daily_nutrition_plan", {"days": [_day_plan()]})


async def test_oauth_tokens_still_work_beside_api_tokens(client):
    async with mcp_with_headers({"Authorization": f"Bearer {mint_mcp_oauth_token()}"}) as agent:
        tools = {tool.name for tool in await agent.list_tools()}
    assert tools == EXPECTED_TOOLS


async def test_api_token_calls_are_scoped_to_the_token_owner(client, auth_headers):
    alice = await _create_logged_in_user(client, auth_headers, "mcp-alice@example.test")
    bob = await _create_logged_in_user(client, auth_headers, "mcp-bob@example.test")
    me = await client.get("/api/v1/auth/me", headers=alice)
    token = await _owned_token(me.json()["id"])

    async with mcp_with_headers({"Authorization": f"Bearer {token}"}) as agent:
        written = await agent.call_tool("upsert_daily_nutrition_plan", {"days": [_day_plan()]})
        assert written.data["days"][0]["grocery_items"][0]["name"] == "Turkey breast"
        logged = await agent.call_tool(
            "log_readiness_and_activity",
            {"readiness": {"soreness": 4, "fatigue": 3}, "activity": {"type": "swim_sauna"}},
        )
        assert logged.data["readiness_log"]["source"] == "mcp"
        context = await agent.call_tool("get_coaching_context", {"days": 1})
        assert context.data["training"]["totals"]["swim_sessions"] == 1

    mine = await client.get(f"/api/v1/meal-plans/{TODAY.isoformat()}", headers=alice)
    assert mine.status_code == 200
    theirs = await client.get(f"/api/v1/meal-plans/{TODAY.isoformat()}", headers=bob)
    assert theirs.status_code == 404
    alice_logs = await client.get("/api/v1/logs", headers=alice)
    assert alice_logs.json()["total"] == 1


async def test_coach_workout_tool_round_trip(client, auth_headers):
    token = await _token(client, auth_headers, ["read", "log"])
    async with mcp_with_headers({"Authorization": f"Bearer {token}"}) as agent:
        result = await agent.call_tool(
            "upsert_adaptive_workout_plan",
            {
                "scheduled_date": TODAY.isoformat(),
                "name": "Lower B",
                "exercises": [
                    {
                        "exercise_name": "Romanian Deadlift",
                        "target_sets": 3,
                        "target_reps_min": 8,
                        "target_weight_kg": 60,
                        "target_rir": 2,
                        "rationale": "Hinge, no deep knee flexion",
                    }
                ],
            },
        )
        assert result.data["created"] is True
        baseline = await agent.call_tool(
            "get_exercise_baseline", {"exercise_name": "Romanian Deadlift"}
        )
    assert result.data["plan"]["exercises"][0]["coach_rationale"] == "Hinge, no deep knee flexion"
    assert baseline.data["sessions"] == []


async def test_legacy_sse_endpoint_requires_auth(client):
    from app.main import app

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as raw:
            response = await raw.get("/mcp/sse/", headers={"Accept": "text/event-stream"})
    assert response.status_code == 401


def test_api_key_auth_is_off_unless_enabled():
    base = {
        "API_KEY": "x" * 40,
        "PUBLIC_BASE_URL": "https://fitness.example.test",
        "MCP_OAUTH_ENABLED": False,
    }
    assert build_mcp_auth(Settings(**base, MCP_API_KEY_AUTH_ENABLED=False)) is None
    provider = build_mcp_auth(Settings(**base, MCP_API_KEY_AUTH_ENABLED=True))
    assert isinstance(provider, ApiKeyOrOAuthAuth)
    with pytest.raises(ValueError, match="PUBLIC_BASE_URL"):
        Settings(API_KEY="x" * 40, PUBLIC_BASE_URL="", MCP_API_KEY_AUTH_ENABLED=True)
