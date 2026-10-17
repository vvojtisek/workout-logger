"""The production Auth0 OAuth-proxy path, end to end, against a fake Auth0.

The rest of the MCP suite uses the plain "jwt" verifier. That path never runs
FastMCP's OAuth proxy, so it could not catch the proxy advertising no scopes,
rejecting a client that registers for `read log`, or issuing tokens that see
no tools. Here the real `Auth0Provider` built by `app.mcp.oauth` runs the full
Dynamic Client Registration + PKCE flow a client such as Claude or ChatGPT
walks; only Auth0's own endpoints (discovery, /authorize, /oauth/token, JWKS)
are faked, and no network is used.
"""

import base64
import hashlib
import json
import secrets
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import FastAPI
from fastmcp.server.auth.oidc_proxy import OIDCConfiguration
from fastmcp.server.auth.providers.jwt import JWTVerifier, RSAKeyPair

from app.config import Settings
from app.main import register_mcp_routes
from app.mcp import mcp
from app.mcp.oauth import build_mcp_oauth_provider
from tests.test_mcp_server import EXPECTED_TOOLS

BASE = "https://fitness.example.test"
AUTH0_ISSUER = "https://tenant.eu.auth0.example/"
AUDIENCE = f"{BASE}/mcp/"
SUBJECT = "google-oauth2|allowed-user"
CLIENT_REDIRECT = "https://claude.ai/api/mcp/auth_callback"


class FakeAuth0:
    """Auth0's token endpoint: grants what /authorize asked for, like an API
    with the `read` and `log` permissions and RBAC off."""

    def __init__(self, key: RSAKeyPair) -> None:
        self.key = key
        self.authorize_query: dict[str, str] = {}

    def token_client(self):
        fake = self

        class Client:
            client_secret = "upstream-secret"

            async def fetch_token(self, url, **params):
                granted = fake.authorize_query.get("scope", "")
                scopes = [scope for scope in granted.split() if scope != "openid"]
                return {
                    "access_token": fake.key.create_token(
                        subject=SUBJECT, issuer=AUTH0_ISSUER, audience=AUDIENCE, scopes=scopes
                    ),
                    "token_type": "Bearer",
                    "expires_in": 86400,
                    "scope": " ".join(scopes),
                    "refresh_token": "upstream-refresh",
                }

            async def aclose(self):
                return None

        return Client()


@pytest.fixture
def auth0_app(monkeypatch, tmp_path, app_engine):
    discovery = {
        "issuer": AUTH0_ISSUER,
        "authorization_endpoint": f"{AUTH0_ISSUER}authorize",
        "token_endpoint": f"{AUTH0_ISSUER}oauth/token",
        "jwks_uri": f"{AUTH0_ISSUER}.well-known/jwks.json",
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
    }
    monkeypatch.setattr(
        OIDCConfiguration,
        "get_oidc_configuration",
        classmethod(lambda cls, *args, **kwargs: cls.model_validate(discovery)),
    )
    settings = Settings(
        API_KEY="x" * 40,
        PUBLIC_BASE_URL=f"{BASE}/",
        MCP_OAUTH_ENABLED=True,
        MCP_OAUTH_PROVIDER="auth0",
        MCP_OAUTH_ISSUER=AUTH0_ISSUER.rstrip("/"),
        MCP_OAUTH_CLIENT_ID="upstream-client",
        MCP_OAUTH_CLIENT_SECRET="upstream-secret",
        MCP_OAUTH_AUDIENCE=AUDIENCE,
        MCP_OAUTH_ALLOWED_SUBJECTS=SUBJECT,
        MCP_OAUTH_JWT_SIGNING_KEY="test-signing-key-" + "k" * 32,
        MCP_OAUTH_STORAGE_KEY="test-storage-key-" + "s" * 32,
        MCP_OAUTH_STORAGE_DIR=str(tmp_path / "mcp-oauth"),
    )
    key = RSAKeyPair.generate()
    fake = FakeAuth0(key)
    provider = build_mcp_oauth_provider(settings)
    proxy = provider._delegate
    proxy._token_validator = JWTVerifier(
        public_key=key.public_key, issuer=AUTH0_ISSUER, audience=AUDIENCE
    )
    monkeypatch.setattr(proxy, "_create_upstream_oauth_client", fake.token_client)

    monkeypatch.setattr(mcp, "auth", provider)
    mcp_app = mcp.http_app(path="/")
    app = FastAPI(lifespan=mcp_app.lifespan)
    register_mcp_routes(app, mcp_app, provider, enabled=True)
    return app, fake


async def _authorize(http: httpx.AsyncClient, fake: FakeAuth0, scope: str | None) -> str:
    """Walk register -> authorize -> consent -> Auth0 -> callback -> token like
    an MCP client and its user's browser would, and return the access token."""
    registration = {
        "redirect_uris": [CLIENT_REDIRECT],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "client_name": "Claude",
    }
    if scope is not None:
        registration["scope"] = scope
    registered = await http.post("/mcp/register", json=registration)
    assert registered.status_code == 201, registered.text
    client_id = registered.json()["client_id"]

    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    query = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CLIENT_REDIRECT,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "client-state",
        "resource": AUDIENCE,
    }
    if scope is not None:
        query["scope"] = scope
    response = await http.get("/mcp/authorize", params=query)
    assert response.status_code == 302, response.text
    consent_page = await http.get(response.headers["location"])
    assert consent_page.status_code == 200
    form = {
        name: value
        for name, value in (
            (field.split('name="')[1].split('"')[0], field.split('value="')[1].split('"')[0])
            for field in consent_page.text.split("<input")[1:]
            if 'name="' in field and 'value="' in field
        )
    }
    form["action"] = "approve"
    approved = await http.post(consent_page.url.path, params=consent_page.url.params, data=form)
    assert approved.status_code in (302, 303), approved.text

    upstream = urlparse(approved.headers["location"])
    assert f"{upstream.scheme}://{upstream.netloc}/" == AUTH0_ISSUER
    fake.authorize_query = {k: v[0] for k, v in parse_qs(upstream.query).items()}

    callback = await http.get(
        "/mcp/auth/callback",
        params={"code": "upstream-code", "state": fake.authorize_query["state"]},
    )
    assert callback.status_code == 302, callback.text
    code = parse_qs(urlparse(callback.headers["location"]).query)["code"][0]

    token = await http.post(
        "/mcp/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": CLIENT_REDIRECT,
            "client_id": client_id,
        },
    )
    assert token.status_code == 200, token.text
    return token.json()["access_token"]


async def _open_session(http: httpx.AsyncClient, access_token: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json, text/event-stream",
    }
    initialized = await http.post(
        "/mcp/",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "auth0-flow-test", "version": "1"},
            },
        },
    )
    assert initialized.status_code == 200, initialized.text
    if session_id := initialized.headers.get("mcp-session-id"):
        headers["mcp-session-id"] = session_id
    await http.post(
        "/mcp/", headers=headers, json={"jsonrpc": "2.0", "method": "notifications/initialized"}
    )
    return headers


async def _tool_names(http: httpx.AsyncClient, access_token: str) -> set[str]:
    headers = await _open_session(http, access_token)
    listed = await http.post(
        "/mcp/", headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}
    )
    assert listed.status_code == 200, listed.text
    payload = next(
        json.loads(line.removeprefix("data: "))
        for line in listed.text.splitlines()
        if line.startswith("data: ")
    )
    return {tool["name"] for tool in payload["result"]["tools"]}


@asynccontextmanager
async def running(app: FastAPI):
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url=BASE) as client:
            yield client


async def test_auth0_discovery_advertises_read_and_log(auth0_app):
    app, _ = auth0_app
    async with running(app) as client:
        resource = await client.get("/.well-known/oauth-protected-resource/mcp/")
        server = await client.get("/.well-known/oauth-authorization-server")
    assert resource.status_code == server.status_code == 200
    assert set(resource.json()["scopes_supported"]) == {"read", "log"}
    assert set(server.json()["scopes_supported"]) == {"read", "log"}


@pytest.mark.parametrize("requested", ["read log", None], ids=["explicit-scope", "no-scope"])
async def test_a_client_that_logs_in_through_auth0_sees_every_tool(auth0_app, requested):
    app, fake = auth0_app
    async with running(app) as client:
        token = await _authorize(client, fake, requested)
        names = await _tool_names(client, token)

    assert set(fake.authorize_query["scope"].split()) >= {"read", "log", "offline_access"}
    assert fake.authorize_query["audience"] == AUDIENCE
    assert names == EXPECTED_TOOLS


async def test_a_read_only_client_sees_only_read_tools(auth0_app):
    app, fake = auth0_app
    async with running(app) as client:
        token = await _authorize(client, fake, "read")
        names = await _tool_names(client, token)

    assert "get_plan" in names
    assert "log_set" not in names


async def test_the_action_log_names_the_registered_client(auth0_app):
    from sqlalchemy import select

    from app.database import get_session_maker
    from app.models import AuditEvent

    app, fake = auth0_app
    async with running(app) as client:
        token = await _authorize(client, fake, "read log")
        headers = await _open_session(client, token)
        called = await client.post(
            "/mcp/",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "get_progression_rules", "arguments": {}},
            },
        )
        assert called.status_code == 200, called.text

    async with get_session_maker()() as session:
        event = (
            await session.execute(
                select(AuditEvent).where(AuditEvent.action == "mcp:get_progression_rules")
            )
        ).scalar_one()
    assert event.actor == "Claude"
    assert event.oauth_client_name == "Claude"
    assert event.oauth_client_id and event.oauth_client_id != "upstream-client"
    assert event.actor_subject == SUBJECT
