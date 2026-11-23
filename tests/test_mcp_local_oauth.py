"""End-to-end tests for the app-native single-owner OAuth 2.1 Authorization Server
(`MCP_OAUTH_PROVIDER="local"`), pairing window, per-client revocation, and `MCP_MODE`
read-only / disabled guards."""

import base64
import hashlib
import json
import re
from contextlib import asynccontextmanager
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import FastAPI
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from fastmcp.exceptions import ToolError
from sqlalchemy import func, select, update

from app.api.v1.router import api_router
from app.config import Settings
from app.database import get_session_maker
from app.exceptions import register_exception_handlers
from app.main import register_mcp_routes
from app.mcp import mcp
from app.mcp.oauth import (
    CSRF_COOKIE_NAME,
    SingleOwnerOAuthProvider,
    build_mcp_oauth_provider,
    hash_oauth_token,
    is_redirect_uri_allowed,
)
from app.models import McpOAuthClient, McpOAuthToken, User
from app.models.base import utcnow
from app.security_passwords import hash_password

BASE = "https://fitness.example.test"
ADMIN_EMAIL = "local-oauth-admin@example.test"
ADMIN_PASSWORD = "correct-horse-battery-staple-local"
ALLOWED_REDIRECTS = (
    "https://chatgpt.com/connector_platform_oauth_redirect,"
    "https://chatgpt.com/connector/oauth/*,"
    "https://claude.ai/api/mcp/auth_callback,"
    "http://127.0.0.1:*/callback,"
    "http://localhost:*/callback"
)


def _pkce_pair() -> tuple[str, str]:
    verifier = "pkce-verifier-abcdefghijklmnopqrstuvwxyz-0123456789"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _extract_hidden_input(html_body: str, name: str) -> str:
    match = re.search(rf'name="{re.escape(name)}"\s+value="([^"]+)"', html_body)
    assert match is not None, f"Missing hidden input {name!r} in HTML"
    return match.group(1)


async def _ensure_admin() -> User:
    async with get_session_maker()() as session:
        existing = await session.scalar(select(User).where(User.email == ADMIN_EMAIL))
        if existing is not None:
            return existing
        user = User(
            email=ADMIN_EMAIL,
            password_hash=hash_password(ADMIN_PASSWORD),
            role="admin",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


@pytest.fixture
def local_oauth_app(monkeypatch, app_engine):
    settings = Settings(
        API_KEY="test-api-key-with-at-least-32-characters",
        PUBLIC_BASE_URL=f"{BASE}/",
        MCP_MODE="read_write",
        MCP_OAUTH_ENABLED=True,
        MCP_OAUTH_PROVIDER="local",
        MCP_OAUTH_STORAGE_KEY="test-local-oauth-storage-key-with-at-least-32-chars",
        MCP_OAUTH_ALLOWED_REDIRECT_URIS=ALLOWED_REDIRECTS,
        MCP_OAUTH_MAX_CLIENTS=3,
    )
    monkeypatch.setattr("app.config.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.v1.mcp_status.get_settings", lambda: settings)
    monkeypatch.setattr("app.mcp.audit.get_settings", lambda: settings)

    auth = build_mcp_oauth_provider(settings)
    assert isinstance(auth, SingleOwnerOAuthProvider)
    monkeypatch.setattr(mcp, "auth", auth)
    mcp_http = mcp.http_app(path="/")

    test_app = FastAPI(lifespan=mcp_http.lifespan)
    register_exception_handlers(test_app)
    test_app.include_router(api_router)
    register_mcp_routes(test_app, mcp_http, auth=auth, enabled=True)
    return test_app, auth, settings


@asynccontextmanager
async def running(app: FastAPI):
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url=BASE) as client:
            yield client


def test_redirect_uri_allowlist_matcher():
    patterns = ALLOWED_REDIRECTS.split(",")
    assert is_redirect_uri_allowed("https://claude.ai/api/mcp/auth_callback", patterns)
    assert is_redirect_uri_allowed("https://chatgpt.com/connector/oauth/abc123", patterns)
    assert is_redirect_uri_allowed("http://127.0.0.1:54321/callback", patterns)
    assert is_redirect_uri_allowed("http://localhost:8080/callback", patterns)

    assert not is_redirect_uri_allowed("https://evil.example.com/callback", patterns)
    assert not is_redirect_uri_allowed("https://chatgpt.com/connector/oauth/../../evil", patterns)
    assert not is_redirect_uri_allowed("https://chatgpt.com/connector/oauth/%2e%2e/evil", patterns)
    assert not is_redirect_uri_allowed("https://claude.ai/api/mcp/auth_callback#frag", patterns)
    assert not is_redirect_uri_allowed("http://127.0.0.1/callback", patterns)
    assert not is_redirect_uri_allowed("http://127.0.0.1:54321/other", patterns)
    assert not is_redirect_uri_allowed("https://127.0.0.1:54321/callback", patterns)


async def test_local_oauth_discovery_pairing_window_and_bare_redirects(
    local_oauth_app, auth_headers
):
    app, _, _ = local_oauth_app
    async with running(app) as client:
        for method in ("GET", "POST", "DELETE"):
            redir = await client.request(method, "/mcp", follow_redirects=False)
            assert redir.status_code == 308
            assert redir.headers["location"] == "/mcp/"

        prm = await client.get("/.well-known/oauth-protected-resource/mcp/")
        bare_prm = await client.get("/.well-known/oauth-protected-resource")
        assert prm.status_code == bare_prm.status_code == 200
        assert prm.json() == bare_prm.json()
        assert prm.json()["resource"] == f"{BASE}/mcp/"
        assert set(prm.json()["scopes_supported"]) == {"read", "log", "manage"}

        as_meta = await client.get("/.well-known/oauth-authorization-server")
        assert as_meta.status_code == 200
        assert as_meta.json()["token_endpoint_auth_methods_supported"] == [
            "none",
            "client_secret_post",
        ]

        # Closed pairing window rejects POST /mcp/register with 403 and zero DB writes
        preflight = await client.options(
            "/mcp/register",
            headers={
                "Origin": "https://claude.ai",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert preflight.status_code == 200

        blocked = await client.post(
            "/mcp/register",
            json={
                "client_name": "Blocked Client",
                "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
            },
        )
        assert blocked.status_code == 403
        assert blocked.json()["error"] == "access_denied"
        async with get_session_maker()() as session:
            assert (await session.scalar(select(func.count()).select_from(McpOAuthClient))) == 0

        # Open pairing window via REST, register up to max cap (3), reject evil redirect URI
        opened = await client.post("/api/v1/mcp-status/pairing-window", headers=auth_headers)
        assert opened.status_code == 200
        assert opened.json()["pairing_window_expires_at"] is not None

        bad_uri = await client.post(
            "/mcp/register",
            json={
                "client_name": "Evil",
                "redirect_uris": ["https://evil.example.com/callback"],
            },
        )
        assert bad_uri.status_code == 400

        for idx in range(3):
            ok = await client.post(
                "/mcp/register",
                json={
                    "client_name": f"Client {idx}",
                    "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
                    "token_endpoint_auth_method": "none",
                },
            )
            assert ok.status_code == 201, ok.text

        over_cap = await client.post(
            "/mcp/register",
            json={
                "client_name": "Client 4",
                "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
                "token_endpoint_auth_method": "none",
            },
        )
        assert over_cap.status_code == 400

        closed = await client.delete("/api/v1/mcp-status/pairing-window", headers=auth_headers)
        assert closed.status_code == 200
        assert closed.json()["pairing_window_expires_at"] is None


async def test_local_oauth_pkce_consent_refresh_replay_and_revocation(
    local_oauth_app, auth_headers
):
    await _ensure_admin()
    app, provider, _ = local_oauth_app

    async with running(app) as client:
        await client.post("/api/v1/mcp-status/pairing-window", headers=auth_headers)
        reg = (
            await client.post(
                "/mcp/register",
                json={
                    "client_name": "Claude Web",
                    "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
                    "grant_types": ["authorization_code", "refresh_token"],
                    "response_types": ["code"],
                    "token_endpoint_auth_method": "client_secret_post",
                },
            )
        ).json()
        client_id = reg["client_id"]
        client_secret = reg["client_secret"]
        verifier, challenge = _pkce_pair()

        # 1. Start authorization
        auth_start = await client.get(
            "/mcp/authorize",
            params={
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": "https://claude.ai/api/mcp/auth_callback",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "scope": "read log manage",
                "state": "state-xyz",
            },
            follow_redirects=False,
        )
        assert auth_start.status_code == 302
        login_page = await client.get(auth_start.headers["location"])
        assert login_page.status_code == 200
        txn_id = _extract_hidden_input(login_page.text, "txn_id")
        csrf_token = _extract_hidden_input(login_page.text, "csrf_token")
        csrf_cookie = login_page.cookies.get(CSRF_COOKIE_NAME)
        assert csrf_cookie == csrf_token

        # CSRF mismatch -> 403
        client.cookies.set(CSRF_COOKIE_NAME, csrf_cookie)
        bad_csrf = await client.post(
            "/mcp/authorize/approve",
            data={
                "txn_id": txn_id,
                "csrf_token": "wrong",
                "decision": "approve",
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD,
                "scopes": ["read", "log"],
            },
        )
        assert bad_csrf.status_code == 403

        # Wrong password -> 401 and rotated CSRF cookie
        bad_pw = await client.post(
            "/mcp/authorize/approve",
            data={
                "txn_id": txn_id,
                "csrf_token": csrf_token,
                "decision": "approve",
                "email": ADMIN_EMAIL,
                "password": "wrong-password",
                "scopes": ["read", "log"],
            },
        )
        assert bad_pw.status_code == 401
        csrf_token = _extract_hidden_input(bad_pw.text, "csrf_token")
        csrf_cookie = bad_pw.cookies.get(CSRF_COOKIE_NAME)
        client.cookies.set(CSRF_COOKIE_NAME, csrf_cookie)

        # Valid approval -> 302 redirect with single-use authorization code
        approved = await client.post(
            "/mcp/authorize/approve",
            data={
                "txn_id": txn_id,
                "csrf_token": csrf_token,
                "decision": "approve",
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD,
                "scopes": ["read", "log", "manage"],
            },
            follow_redirects=False,
        )
        assert approved.status_code == 302
        code = parse_qs(urlparse(approved.headers["location"]).query)["code"][0]

        # Wrong PKCE verifier rejected
        bad_pkce = await client.post(
            "/mcp/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": "https://claude.ai/api/mcp/auth_callback",
                "client_id": client_id,
                "client_secret": client_secret,
                "code_verifier": "wrong-verifier-abcdefghijklmnopqrstuvwxyz-000000",
            },
        )
        assert bad_pkce.status_code in (400, 401)

        # Mint fresh code and exchange with valid PKCE verifier
        auth_start2 = await client.get(
            "/mcp/authorize",
            params={
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": "https://claude.ai/api/mcp/auth_callback",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "scope": "read log manage",
            },
            follow_redirects=False,
        )
        login2 = await client.get(auth_start2.headers["location"])
        txn2 = _extract_hidden_input(login2.text, "txn_id")
        csrf2 = _extract_hidden_input(login2.text, "csrf_token")
        client.cookies.set(CSRF_COOKIE_NAME, login2.cookies.get(CSRF_COOKIE_NAME))
        approved2 = await client.post(
            "/mcp/authorize/approve",
            data={
                "txn_id": txn2,
                "csrf_token": csrf2,
                "decision": "approve",
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD,
                "scopes": ["read", "log", "manage"],
            },
            follow_redirects=False,
        )
        code2 = parse_qs(urlparse(approved2.headers["location"]).query)["code"][0]

        exchanged = await client.post(
            "/mcp/token",
            data={
                "grant_type": "authorization_code",
                "code": code2,
                "redirect_uri": "https://claude.ai/api/mcp/auth_callback",
                "client_id": client_id,
                "client_secret": client_secret,
                "code_verifier": verifier,
            },
        )
        assert exchanged.status_code == 200, exchanged.text
        tokens = exchanged.json()
        access_token = tokens["access_token"]
        refresh_1 = tokens["refresh_token"]

        # Call MCP tool using the issued opaque access token
        def factory(headers=None, timeout=None, auth=None, **kwargs):
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url=BASE,
                headers=headers,
                timeout=timeout,
                auth=auth,
                **kwargs,
            )

        transport = StreamableHttpTransport(
            url=f"{BASE}/mcp/",
            headers={"Authorization": f"Bearer {access_token}"},
            httpx_client_factory=factory,
        )
        async with Client(transport) as agent:
            tools = await agent.list_tools()
            assert "update_coaching_notes" in {t.name for t in tools}
            updated = await agent.call_tool(
                "update_coaching_notes",
                {"working_notes_md": "Local OAuth test note", "expected_notes_version": 1},
            )
            assert updated.data["working_notes_md"] == "Local OAuth test note"

        # Refresh token rotation + 30s grace window + replay detection outside grace window
        rot1 = await client.post(
            "/mcp/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_1,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        assert rot1.status_code == 200
        refresh_2 = rot1.json()["refresh_token"]
        assert refresh_2 != refresh_1

        # Inside 30s grace window, refresh_1 still succeeds
        grace = await client.post(
            "/mcp/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_1,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        assert grace.status_code == 200
        refresh_3 = grace.json()["refresh_token"]

        # Backdate refresh_1.rotated_at beyond 30s and replay -> revokes entire family!
        async with get_session_maker()() as session:
            await session.execute(
                update(McpOAuthToken)
                .where(McpOAuthToken.token_hash == hash_oauth_token(refresh_1))
                .values(rotated_at=utcnow() - timedelta(seconds=60))
            )
            await session.commit()

        replay = await client.post(
            "/mcp/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_1,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        assert replay.status_code in (400, 401)

        # Descendant refresh_3 and access_token in the same family are now revoked!
        descendant = await client.post(
            "/mcp/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_3,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        assert descendant.status_code in (400, 401)
        assert await provider.load_access_token(access_token) is None

        # Admin status endpoint lists the active client, and DELETE revokes it
        status_resp = await client.get("/api/v1/mcp-status", headers=auth_headers)
        assert status_resp.status_code == 200
        assert len(status_resp.json()["clients"]) == 1
        assert status_resp.json()["clients"][0]["client_id"] == client_id

        revoked = await client.delete(
            f"/api/v1/mcp-status/clients/{client_id}", headers=auth_headers
        )
        assert revoked.status_code == 204
        again = await client.delete(f"/api/v1/mcp-status/clients/{client_id}", headers=auth_headers)
        assert again.status_code == 404


async def test_mcp_mode_read_only_blocks_writes_and_disabled_blocks_admin_actions(
    client, auth_headers, monkeypatch
):
    from app.config import get_settings

    base = get_settings()
    ro_settings = Settings(**{**base.model_dump(), "MCP_MODE": "read_only"})
    monkeypatch.setattr("app.mcp.audit.get_settings", lambda: ro_settings)
    monkeypatch.setattr("app.api.v1.mcp_status.get_settings", lambda: ro_settings)

    status_ro = await client.get("/api/v1/mcp-status", headers=auth_headers)
    assert status_ro.json()["mode"] == "read_only"

    from tests.conftest import mint_mcp_oauth_token
    from tests.test_mcp_server import mcp_client

    async with mcp_client(mint_mcp_oauth_token()) as agent:
        programs = await agent.call_tool("list_programs", {})
        assert "items" in programs.data
        with pytest.raises(ToolError, match="MCP_READ_ONLY_MODE"):
            await agent.call_tool(
                "update_coaching_notes",
                {"working_notes_md": "Blocked in read_only", "expected_notes_version": 1},
            )

    disabled_settings = Settings(**{**base.model_dump(), "MCP_MODE": "disabled"})
    monkeypatch.setattr("app.api.v1.mcp_status.get_settings", lambda: disabled_settings)
    status_dis = await client.get("/api/v1/mcp-status", headers=auth_headers)
    assert status_dis.json()["enabled"] is False
    assert status_dis.json()["tool_count"] == 0
    open_dis = await client.post("/api/v1/mcp-status/pairing-window", headers=auth_headers)
    assert open_dis.status_code == 409
    assert open_dis.json()["code"] == "MCP_DISABLED"
    _ = json.dumps({"ok": True})
