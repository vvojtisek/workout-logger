"""The action log: who changed what, kept for 72 hours.

Every write through the REST API (the app's UI included) and every MCP tool
call leaves one row naming its originator. Health values, passwords and
tokens never reach the log.
"""

import json
import uuid
from datetime import timedelta

from mcp.types import Implementation
from sqlalchemy import select

from app.database import get_session_maker
from app.models import AuditEvent
from app.models.base import utcnow
from app.services import audit_log
from scripts.create_first_admin import create_first_admin
from tests.conftest import TEST_MCP_OAUTH_ALLOWED_SUBJECT, mint_mcp_oauth_token
from tests.test_mcp_server import mcp_client

EVENTS = "/api/v1/audit-events"
LOGIN = "/api/v1/auth/login"
INVITES = "/api/v1/invites"
ACCEPT = "/api/v1/auth/invites/accept"
PASSWORD = "correct horse battery staple"


async def _events() -> list[AuditEvent]:
    async with get_session_maker()() as session:
        result = await session.execute(select(AuditEvent).order_by(AuditEvent.occurred_at))
        return list(result.scalars())


async def _login_user(client, auth_headers, email: str) -> None:
    created = await client.post(
        INVITES, json={"email": email, "role": "user"}, headers=auth_headers
    )
    await client.post(ACCEPT, json={"token": created.json()["token"], "password": PASSWORD})
    assert (
        await client.post(LOGIN, json={"email": email, "password": PASSWORD})
    ).status_code == 200


def _stored(event: AuditEvent) -> str:
    """Everything the row holds, as one string, for "must not contain" checks."""
    return json.dumps(
        {column.name: str(getattr(event, column.key)) for column in AuditEvent.__table__.columns}
    )


async def test_a_ui_write_names_the_user_and_its_target(client, auth_headers):
    await _login_user(client, auth_headers, "logged.user@example.test")
    response = await client.post("/api/v1/plans", json={"name": "Push day", "exercises": []})
    assert response.status_code == 201
    plan_id = response.json()["id"]

    event = (await _events())[-1]
    assert event.actor_kind == "user"
    assert event.actor == "logged.user@example.test"
    assert event.action == "POST /api/v1/plans"
    assert event.target_type == "plans"
    assert event.target_id == plan_id
    assert event.outcome == "success"
    assert event.status_code == 201
    assert json.loads(event.params)["name"] == "Push day"


async def test_health_values_are_not_logged(client, auth_headers):
    response = await client.post(
        "/api/v1/body-metrics",
        json={"measured_at": "2026-10-16T07:00:00Z", "weight_kg": 81.37, "waist_cm": 93.21},
        headers=auth_headers,
    )
    assert response.status_code == 201

    event = (await _events())[-1]
    assert event.action == "POST /api/v1/body-metrics"
    params = json.loads(event.params)
    assert set(params) == {"measured_at", "weight_kg", "waist_cm"}
    assert "81.37" not in _stored(event)
    assert "93.21" not in _stored(event)


async def test_passwords_and_tokens_are_not_logged(client, auth_headers):
    await create_first_admin("admin.secret@example.test", PASSWORD)
    await client.post(LOGIN, json={"email": "admin.secret@example.test", "password": PASSWORD})
    created = await client.post(
        "/api/v1/tokens", json={"name": "watch sync", "scopes": ["log"]}, headers=auth_headers
    )
    raw_token = created.json()["token"]

    stored = " ".join(_stored(event) for event in await _events())
    assert PASSWORD not in stored
    assert raw_token not in stored


async def test_a_failed_write_is_logged_as_an_error(client, auth_headers):
    missing = uuid.uuid4()
    response = await client.put(
        f"/api/v1/plans/{missing}", json={"name": "Gone", "exercises": []}, headers=auth_headers
    )
    assert response.status_code == 404

    event = (await _events())[-1]
    assert event.actor_kind == "api_key"
    assert event.action == "PUT /api/v1/plans/{plan_id}"
    assert event.target_id == str(missing)
    assert event.outcome == "error"
    assert event.status_code == 404


async def test_reads_are_not_logged(client, auth_headers):
    await client.get("/api/v1/plans", headers=auth_headers)
    await client.get("/health")
    assert await _events() == []


async def test_an_api_token_write_names_the_token(client, auth_headers):
    created = await client.post(
        "/api/v1/tokens",
        json={"name": "Health Connect sync", "scopes": ["log"]},
        headers=auth_headers,
    )
    token = created.json()["token"]
    await client.post(
        "/api/v1/body-metrics",
        json={"measured_at": "2026-10-16T07:00:00Z", "weight_kg": 80.0},
        headers={"X-API-Key": token},
    )

    event = (await _events())[-1]
    assert event.actor_kind == "api_token"
    assert event.actor == "Health Connect sync"


async def test_an_mcp_tool_call_names_the_client_and_subject(client, auth_headers):
    token = mint_mcp_oauth_token()
    client_info = Implementation(name="claude-ai", version="0.1.0")
    async with mcp_client(token, client_info=client_info) as agent:
        await agent.call_tool(
            "log_biometrics", {"measured_at": "2026-10-16T07:00:00Z", "weight_kg": 79.93}
        )

    event = [e for e in await _events() if e.action == "mcp:log_biometrics"][-1]
    assert event.actor_kind == "mcp"
    assert event.actor_subject == TEST_MCP_OAUTH_ALLOWED_SUBJECT
    assert event.mcp_client_name == "claude-ai"
    assert event.mcp_client_version == "0.1.0"
    assert event.outcome == "success"
    assert event.target_type == "body_metric"
    assert event.target_id
    assert "79.93" not in _stored(event)


async def test_a_failed_mcp_tool_call_is_logged_as_an_error(client, auth_headers):
    async with mcp_client(mint_mcp_oauth_token()) as agent:
        result = await agent.call_tool(
            "get_plan", {"plan_id": str(uuid.uuid4())}, raise_on_error=False
        )
    assert result.is_error

    event = [e for e in await _events() if e.action == "mcp:get_plan"][-1]
    assert event.outcome == "error"
    assert event.error


async def test_events_older_than_72_hours_are_deleted(client, auth_headers):
    async with get_session_maker()() as session:
        session.add_all(
            [
                AuditEvent(
                    occurred_at=utcnow() - timedelta(hours=73),
                    actor_kind="user",
                    actor="old",
                    action="POST /api/v1/plans",
                    outcome="success",
                ),
                AuditEvent(
                    occurred_at=utcnow() - timedelta(hours=71),
                    actor_kind="user",
                    actor="recent",
                    action="POST /api/v1/plans",
                    outcome="success",
                ),
            ]
        )
        await session.commit()

    async with get_session_maker()() as session:
        deleted = await audit_log.prune(session)
    assert deleted == 1
    assert [event.actor for event in await _events()] == ["recent"]


async def test_each_write_prunes_expired_events(client, auth_headers):
    async with get_session_maker()() as session:
        session.add(
            AuditEvent(
                occurred_at=utcnow() - timedelta(hours=80),
                actor_kind="user",
                actor="old",
                action="POST /api/v1/plans",
                outcome="success",
            )
        )
        await session.commit()

    await client.post("/api/v1/plans", json={"name": "New", "exercises": []}, headers=auth_headers)
    assert "old" not in [event.actor for event in await _events()]


async def test_admin_lists_events_newest_first_and_never_older_than_72_hours(client, auth_headers):
    async with get_session_maker()() as session:
        session.add(
            AuditEvent(
                occurred_at=utcnow() - timedelta(hours=90),
                actor_kind="user",
                actor="expired",
                action="POST /api/v1/plans",
                outcome="success",
            )
        )
        await session.commit()
    await client.post("/api/v1/plans", json={"name": "A", "exercises": []}, headers=auth_headers)
    await client.post("/api/v1/plans", json={"name": "B", "exercises": []}, headers=auth_headers)

    response = await client.get(EVENTS, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["retention_hours"] == 72
    names = [item["params"]["name"] for item in body["items"]]
    assert names == ["B", "A"]
    assert all(item["actor"] != "expired" for item in body["items"])


async def test_only_an_admin_can_read_the_log(client, auth_headers):
    await _login_user(client, auth_headers, "plain.user@example.test")
    assert (await client.get(EVENTS)).status_code == 403
