import pytest
from fastmcp.exceptions import ToolError
from sqlalchemy.exc import IntegrityError

from app.schemas.coaching_context import MAX_NOTES_BYTES, MAX_PROFILE_BYTES
from app.services import coaching_context as context_service
from tests.conftest import mint_mcp_oauth_token
from tests.test_mcp_server import mcp_client

BASE = "/api/v1/coaching-context"


async def test_coaching_context_rest_versions_byte_limits_and_revert(client, auth_headers):
    initial = await client.get(BASE, headers=auth_headers)
    assert initial.status_code == 200
    body = initial.json()
    assert body["athlete_profile_md"] is None
    assert body["profile_version"] == 1
    assert body["has_previous_profile"] is False
    assert body["working_notes_md"] is None
    assert body["notes_version"] == 1
    assert body["has_previous_notes"] is False

    # Reverting with no previous snapshot returns 409 NO_PREVIOUS_VERSION
    no_prev_profile = await client.post(
        f"{BASE}/revert", json={"target": "profile"}, headers=auth_headers
    )
    assert no_prev_profile.status_code == 409
    assert no_prev_profile.json()["code"] == "NO_PREVIOUS_VERSION"

    no_prev_notes = await client.post(
        f"{BASE}/revert", json={"target": "notes"}, headers=auth_headers
    )
    assert no_prev_notes.status_code == 409
    assert no_prev_notes.json()["code"] == "NO_PREVIOUS_VERSION"

    # UTF-8 byte caps (multi-byte chars count by UTF-8 bytes, not codepoints)
    over_profile = await client.put(
        f"{BASE}/profile",
        json={
            "athlete_profile_md": "č" * (MAX_PROFILE_BYTES // 2 + 1),
            "expected_profile_version": 1,
        },
        headers=auth_headers,
    )
    assert over_profile.status_code == 422

    over_notes = await client.put(
        f"{BASE}/notes",
        json={
            "working_notes_md": "🏒" * (MAX_NOTES_BYTES // 4 + 1),
            "expected_notes_version": 1,
        },
        headers=auth_headers,
    )
    assert over_notes.status_code == 422

    # Exact UTF-8 boundary succeeds
    exact_profile_md = "č" * (MAX_PROFILE_BYTES // 2)
    p1 = await client.put(
        f"{BASE}/profile",
        json={"athlete_profile_md": exact_profile_md, "expected_profile_version": 1},
        headers=auth_headers,
    )
    assert p1.status_code == 200
    assert p1.json()["profile_version"] == 2
    assert p1.json()["has_previous_profile"] is False

    # Stale profile version returns 409 STALE_RECORD
    stale_p = await client.put(
        f"{BASE}/profile",
        json={"athlete_profile_md": "conflict", "expected_profile_version": 1},
        headers=auth_headers,
    )
    assert stale_p.status_code == 409
    assert stale_p.json()["code"] == "STALE_RECORD"

    # Second profile update snapshots previous_profile_md; revert restores it once
    p2 = await client.put(
        f"{BASE}/profile",
        json={"athlete_profile_md": "Protect left knee.", "expected_profile_version": 2},
        headers=auth_headers,
    )
    assert p2.status_code == 200
    assert p2.json()["profile_version"] == 3
    assert p2.json()["has_previous_profile"] is True

    reverted_p = await client.post(
        f"{BASE}/revert", json={"target": "profile"}, headers=auth_headers
    )
    assert reverted_p.status_code == 200
    assert reverted_p.json()["athlete_profile_md"] == exact_profile_md
    assert reverted_p.json()["profile_version"] == 4
    assert reverted_p.json()["has_previous_profile"] is False

    # Notes lifecycle + revert
    n1 = await client.put(
        f"{BASE}/notes",
        json={"working_notes_md": "Week 1 focus: ankle mobility", "expected_notes_version": 1},
        headers=auth_headers,
    )
    assert n1.status_code == 200
    assert n1.json()["notes_version"] == 2

    n2 = await client.put(
        f"{BASE}/notes",
        json={"working_notes_md": "Week 2 focus: deload", "expected_notes_version": 2},
        headers=auth_headers,
    )
    assert n2.status_code == 200
    assert n2.json()["notes_version"] == 3
    assert n2.json()["has_previous_notes"] is True

    reverted_n = await client.post(f"{BASE}/revert", json={"target": "notes"}, headers=auth_headers)
    assert reverted_n.status_code == 200
    assert reverted_n.json()["working_notes_md"] == "Week 1 focus: ankle mobility"
    assert reverted_n.json()["notes_version"] == 4
    assert reverted_n.json()["has_previous_notes"] is False


async def test_coaching_context_mcp_tools_tier1_immutability_and_tier2_conflicts(
    client, auth_headers
):
    await client.put(
        f"{BASE}/profile",
        json={"athlete_profile_md": "No heavy overhead press.", "expected_profile_version": 1},
        headers=auth_headers,
    )

    # Read-only token cannot call update_coaching_notes
    read_token = mint_mcp_oauth_token(scopes=["read"])
    async with mcp_client(read_token) as reader:
        ctx = await reader.call_tool("get_coaching_context", {"days": 3})
        assert ctx.data["working_notes_md"] is None
        assert ctx.data["notes_version"] == 1
        with pytest.raises(ToolError):
            await reader.call_tool(
                "update_coaching_notes",
                {"working_notes_md": "Denied", "expected_notes_version": 1},
            )

    # Log-scoped token updates Tier 2 working_notes_md and leaves Tier 1 untouched
    write_token = mint_mcp_oauth_token(scopes=["read", "log"])
    async with mcp_client(write_token) as agent:
        updated = await agent.call_tool(
            "update_coaching_notes",
            {
                "working_notes_md": "Active goal: 3x mobility sessions this week",
                "expected_notes_version": 1,
            },
        )
        assert updated.data["notes_version"] == 2
        assert updated.data["working_notes_md"] == "Active goal: 3x mobility sessions this week"
        assert updated.data["athlete_profile_md"] == "No heavy overhead press."
        assert updated.data["profile_version"] == 2

        ctx_after = await agent.call_tool("get_coaching_context", {"days": 3})
        assert ctx_after.data["working_notes_md"] == "Active goal: 3x mobility sessions this week"
        assert ctx_after.data["notes_version"] == 2

        with pytest.raises(ToolError, match="version mismatch"):
            await agent.call_tool(
                "update_coaching_notes",
                {"working_notes_md": "Stale write", "expected_notes_version": 1},
            )

        with pytest.raises(ToolError, match="4096 UTF-8 bytes"):
            await agent.call_tool(
                "update_coaching_notes",
                {"working_notes_md": "x" * (MAX_NOTES_BYTES + 1), "expected_notes_version": 2},
            )


async def test_coaching_context_singleton_creation_race(db_session, monkeypatch):
    original = await context_service.get_coaching_context(db_session)

    first_call = True
    real_find = context_service._find_singleton

    async def _racy_find(session):
        nonlocal first_call
        if first_call:
            first_call = False
            return None
        return await real_find(session)

    monkeypatch.setattr(context_service, "_find_singleton", _racy_find)
    fetched = await context_service.get_coaching_context(db_session)
    assert fetched.id == original.id

    async def _always_none(session):
        return None

    async def _fail_commit():
        raise IntegrityError("stmt", {}, Exception("boom"))

    monkeypatch.setattr(context_service, "_find_singleton", _always_none)
    monkeypatch.setattr(db_session, "commit", _fail_commit)
    with pytest.raises(IntegrityError):
        await context_service.get_coaching_context(db_session)
