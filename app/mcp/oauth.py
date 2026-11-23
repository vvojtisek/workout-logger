"""OAuth 2.1 authentication for the MCP transport.

Supports three `MCP_OAUTH_PROVIDER` backends:
- "local": App-native single-owner OAuth 2.1 Authorization Server backed by
  SQLite (`mcp_oauth_clients`, `mcp_oauth_tokens`) with an explicit 10-minute
  in-memory admin pairing window (`POST /mcp/register` returns 403 when closed),
  strict-CSP owner login/consent (`/static/oauth_consent.css`), opaque SHA-256
  access/refresh tokens with Fernet-encrypted metadata, refresh rotation + 30s
  grace window + family revocation on replay, and per-client revocation.
- "auth0" (default): FastMCP's `Auth0Provider`, an OAuth proxy that bridges MCP
  clients requiring Dynamic Client Registration to a single pre-registered
  confidential Auth0 application, wrapped in `SubjectAllowlistAuth`.
- "jwt": a plain resource-server `JWTVerifier` against a known issuer's
  JWKS/public key, wrapped in `SubjectAllowlistAuth`.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import posixpath
import secrets
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Generic, TypeVar
from urllib.parse import unquote, urlparse

from cryptography.fernet import Fernet, InvalidToken
from fastmcp.server.auth import AccessToken, AuthProvider, OAuthProvider, RemoteAuthProvider
from fastmcp.server.auth.providers.auth0 import Auth0Provider
from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.utilities.logging import get_logger
from key_value.aio.stores.filetree import FileTreeStore
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper
from mcp.server.auth.handlers.metadata import MetadataHandler
from mcp.server.auth.provider import (
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    RegistrationError,
    TokenError,
    construct_redirect_uri,
)
from mcp.server.auth.routes import build_metadata, cors_middleware
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyHttpUrl, AnyUrl
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import Settings
from app.database import get_session_maker
from app.exceptions import RateLimitedError
from app.models.base import utcnow
from app.models.mcp_oauth import McpOAuthClient, McpOAuthToken
from app.models.user import User
from app.security_passwords import verify_password
from app.services import login_rate_limit

logger = get_logger(__name__)

MCP_MOUNT_PATH = "/mcp"
MCP_OAUTH_STORAGE_SALT = "workout-logger-mcp-oauth-v1"
MCP_OAUTH_KDF_PREFIX = "workout-logger-mcp-oauth-v2:"
# Scopes advertised by legacy auth0/jwt providers.
MCP_CLIENT_SCOPES = ["read", "log"]
# Scopes advertised by the app-native single-owner OAuth 2.1 provider.
VALID_MCP_SCOPES: tuple[str, ...] = ("read", "log", "manage")
SUPPORTED_AUTH_METHODS: tuple[str, ...] = ("none", "client_secret_post")

PENDING_TXN_TTL_SECONDS = 600
AUTH_CODE_TTL_SECONDS = 120
MAX_IN_MEMORY_HANDSHAKES = 64
REFRESH_GRACE_WINDOW_SECONDS = 30
LAST_USED_THROTTLE_SECONDS = 60
CSRF_COOKIE_NAME = "wl_mcp_csrf"
CSRF_COOKIE_PATH = "/mcp/authorize"

_T = TypeVar("_T")


def derive_fernet(storage_key: str) -> Fernet:
    """Derive a 32-byte Fernet key deterministically from `MCP_OAUTH_STORAGE_KEY`."""
    digest = hashlib.sha256(f"{MCP_OAUTH_KDF_PREFIX}{storage_key}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def hash_oauth_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def is_redirect_uri_allowed(uri: str, patterns: list[str]) -> bool:
    """Validate a redirect URI against configured allowlist patterns:
    - Exact literal match (`https://claude.ai/api/mcp/auth_callback`)
    - Loopback port wildcard (`http://127.0.0.1:*/callback`, `http://localhost:*/callback`)
    - Path-prefix wildcard (`https://chatgpt.com/connector/oauth/*`)
    """
    parsed_uri = urlparse(uri)
    if parsed_uri.fragment:
        return False

    for raw_pattern in patterns:
        pattern = raw_pattern.strip()
        if not pattern:
            continue
        if uri == pattern:
            return True

        if ":*/" in pattern:
            scheme_host, expected_path = pattern.split(":*", 1)
            if scheme_host in {"http://127.0.0.1", "http://localhost"}:
                expected_host = scheme_host.removeprefix("http://")
                try:
                    port = parsed_uri.port
                except ValueError:
                    port = None
                if (
                    parsed_uri.scheme == "http"
                    and parsed_uri.hostname == expected_host
                    and port is not None
                    and 1 <= port <= 65535
                    and parsed_uri.path == expected_path
                    and not parsed_uri.query
                ):
                    return True
            continue

        if pattern.endswith("/*"):
            prefix_url = pattern[:-1]
            parsed_prefix = urlparse(prefix_url)
            if (
                parsed_uri.scheme == parsed_prefix.scheme
                and parsed_uri.netloc == parsed_prefix.netloc
            ):
                decoded_path = unquote(parsed_uri.path)
                if "\\" in decoded_path or ".." in decoded_path.split("/"):
                    continue
                normalized = posixpath.normpath(decoded_path)
                if decoded_path.endswith("/") and not normalized.endswith("/"):
                    normalized += "/"
                if normalized.startswith(parsed_prefix.path):
                    return True

    return False


class _BoundedTTLStore(Generic[_T]):
    """In-memory bounded LRU map with per-entry monotonic expiry."""

    def __init__(self, maxsize: int) -> None:
        self._maxsize = maxsize
        self._entries: OrderedDict[str, tuple[float, _T]] = OrderedDict()

    def _evict_expired(self, now: float) -> None:
        expired = [k for k, (exp, _) in self._entries.items() if exp <= now]
        for key in expired:
            del self._entries[key]

    def set(self, key: str, value: _T, ttl_seconds: int) -> None:
        now = time.monotonic()
        self._evict_expired(now)
        if key in self._entries:
            del self._entries[key]
        while len(self._entries) >= self._maxsize:
            self._entries.popitem(last=False)
        self._entries[key] = (now + ttl_seconds, value)

    def get(self, key: str) -> _T | None:
        now = time.monotonic()
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= now:
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return value

    def pop(self, key: str) -> _T | None:
        now = time.monotonic()
        entry = self._entries.pop(key, None)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= now:
            return None
        return value

    def __len__(self) -> int:
        self._evict_expired(time.monotonic())
        return len(self._entries)


@dataclass(slots=True)
class _PendingAuthorization:
    client_id: str
    client_name: str | None
    redirect_uri: str
    redirect_uri_provided_explicitly: bool
    state: str | None
    code_challenge: str
    requested_scopes: list[str]
    resource: str


@dataclass(slots=True)
class _StoredAuthCode:
    code: str
    client_id: str
    user_id: uuid.UUID
    scopes: list[str]
    expires_at: float
    code_challenge: str
    redirect_uri: str
    redirect_uri_provided_explicitly: bool
    resource: str

    def to_sdk_model(self) -> AuthorizationCode:
        return AuthorizationCode(
            code=self.code,
            scopes=list(self.scopes),
            expires_at=self.expires_at,
            client_id=self.client_id,
            code_challenge=self.code_challenge,
            redirect_uri=AnyUrl(self.redirect_uri),
            redirect_uri_provided_explicitly=self.redirect_uri_provided_explicitly,
            resource=self.resource,
        )


class _StoredRefreshToken(RefreshToken):
    token_id: uuid.UUID
    token_family_id: uuid.UUID
    absolute_expires_at: datetime | None = None
    rotated_at: datetime | None = None
    user_id: uuid.UUID


class _PairingWindowGateASGI:
    """ASGI wrapper around `/register` that preserves `OPTIONS` CORS preflight
    and rejects `POST` with HTTP `403` before reading the request body whenever
    the in-memory pairing window is closed."""

    def __init__(self, app: ASGIApp, provider: SingleOwnerOAuthProvider) -> None:
        self._app = app
        self._provider = provider

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            method = scope.get("method", "").upper()
            if method == "POST" and not self._provider.is_pairing_window_open():
                response = JSONResponse(
                    {
                        "error": "access_denied",
                        "error_description": "Pairing window is closed",
                    },
                    status_code=403,
                    headers={"Cache-Control": "no-store"},
                )
                await response(scope, receive, send)
                return
        await self._app(scope, receive, send)


def _render_error_html(title: str, message: str, status_code: int) -> HTMLResponse:
    escaped_title = html.escape(title)
    escaped_message = html.escape(message)
    body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escaped_title} — Workout Logger</title>
  <link rel="stylesheet" href="/static/oauth_consent.css">
</head>
<body>
  <main class="consent-card">
    <h1 class="consent-title">{escaped_title}</h1>
    <div class="consent-alert" role="alert">{escaped_message}</div>
    <p class="consent-subtitle">Return to your AI client and start a new connection if needed.</p>
  </main>
</body>
</html>"""
    return HTMLResponse(
        content=body, status_code=status_code, headers={"Cache-Control": "no-store"}
    )


def _render_consent_html(
    *,
    txn_id: str,
    csrf_token: str,
    pending: _PendingAuthorization,
    selected_scopes: list[str] | None = None,
    email: str = "",
    error_message: str | None = None,
    status_code: int = 200,
) -> HTMLResponse:
    client_label = html.escape(pending.client_name or pending.client_id)
    redirect_label = html.escape(pending.redirect_uri)
    email_escaped = html.escape(email)
    txn_escaped = html.escape(txn_id)
    csrf_escaped = html.escape(csrf_token)
    checked = set(selected_scopes if selected_scopes is not None else pending.requested_scopes)

    scope_descriptions = {
        "read": "Read training logs, nutrition summaries, sleep, biometrics, and coaching context",
        "log": "Log workouts, sets, meals, sleep, recovery, and body measurements",
        "manage": "Create or update plans, schedules, historical logs, and working coaching notes",
    }
    scope_inputs = []
    for scope_name in pending.requested_scopes:
        is_checked = " checked" if scope_name in checked else ""
        desc = html.escape(scope_descriptions.get(scope_name, scope_name))
        scope_escaped = html.escape(scope_name)
        scope_inputs.append(
            f'<label class="consent-scope-item">'
            f'<input type="checkbox" name="scopes" value="{scope_escaped}"{is_checked}>'
            f"<span><strong>{scope_escaped}</strong> — {desc}</span>"
            f"</label>"
        )

    alert_html = (
        f'<div class="consent-alert" role="alert">{html.escape(error_message)}</div>'
        if error_message
        else ""
    )

    body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize MCP Client — Workout Logger</title>
  <link rel="stylesheet" href="/static/oauth_consent.css">
</head>
<body>
  <main class="consent-card">
    <h1 class="consent-title">Authorize AI Client</h1>
    <p class="consent-subtitle">Sign in with your Workout Logger admin account to link this client.</p>
    {alert_html}
    <dl class="consent-meta">
      <dt>Client</dt>
      <dd>{client_label}</dd>
      <dt>Redirect URI</dt>
      <dd>{redirect_label}</dd>
    </dl>
    <form method="post" action="/mcp/authorize/approve" autocomplete="off">
      <input type="hidden" name="txn_id" value="{txn_escaped}">
      <input type="hidden" name="csrf_token" value="{csrf_escaped}">
      <div class="consent-field">
        <label class="consent-label" for="oauth-email">Admin email</label>
        <input class="consent-input" id="oauth-email" name="email" type="email" value="{email_escaped}" autocomplete="username">
      </div>
      <div class="consent-field">
        <label class="consent-label" for="oauth-password">Password</label>
        <input class="consent-input" id="oauth-password" name="password" type="password" autocomplete="current-password">
      </div>
      <fieldset class="consent-scopes">
        <legend>Permissions</legend>
        {"".join(scope_inputs)}
      </fieldset>
      <div class="consent-actions">
        <button class="consent-btn consent-btn-secondary" type="submit" name="decision" value="deny">Deny</button>
        <button class="consent-btn consent-btn-primary" type="submit" name="decision" value="approve">Approve</button>
      </div>
    </form>
  </main>
</body>
</html>"""
    return HTMLResponse(
        content=body, status_code=status_code, headers={"Cache-Control": "no-store"}
    )


class SingleOwnerOAuthProvider(OAuthProvider):
    """App-native single-owner OAuth 2.1 Authorization Server backed by SQLite."""

    def __init__(self, settings: Settings) -> None:
        if not settings.MCP_OAUTH_STORAGE_KEY:
            raise ValueError("MCP_OAUTH_STORAGE_KEY must be set when MCP_OAUTH_PROVIDER=local")
        self._settings = settings
        self._fernet = derive_fernet(settings.MCP_OAUTH_STORAGE_KEY)
        self._base_root = settings.mcp_oauth_base_url_resolved
        self._canonical_resource = f"{self._base_root}{MCP_MOUNT_PATH}/"
        self._pairing_expires_at: datetime | None = None
        self._pending_txns: _BoundedTTLStore[_PendingAuthorization] = _BoundedTTLStore(
            MAX_IN_MEMORY_HANDSHAKES
        )
        self._auth_codes: _BoundedTTLStore[_StoredAuthCode] = _BoundedTTLStore(
            MAX_IN_MEMORY_HANDSHAKES
        )

        super().__init__(
            base_url=f"{self._base_root}{MCP_MOUNT_PATH}",
            issuer_url=self._base_root,
            resource_base_url=f"{self._base_root}{MCP_MOUNT_PATH}",
            client_registration_options=ClientRegistrationOptions(
                enabled=True,
                valid_scopes=list(VALID_MCP_SCOPES),
                default_scopes=list(VALID_MCP_SCOPES),
            ),
            revocation_options=RevocationOptions(enabled=True),
            required_scopes=[],
        )

    @property
    def pairing_window_expires_at(self) -> datetime | None:
        if self._pairing_expires_at is None:
            return None
        if self._pairing_expires_at <= utcnow():
            self._pairing_expires_at = None
            return None
        return self._pairing_expires_at

    def is_pairing_window_open(self) -> bool:
        return self.pairing_window_expires_at is not None

    def open_pairing_window(self, minutes: int | None = None) -> datetime:
        ttl_minutes = (
            minutes if minutes is not None else self._settings.MCP_OAUTH_PAIRING_WINDOW_MINUTES
        )
        expires_at = utcnow() + timedelta(minutes=ttl_minutes)
        self._pairing_expires_at = expires_at
        return expires_at

    def close_pairing_window(self) -> None:
        self._pairing_expires_at = None

    def _encrypt_text(self, value: str) -> str:
        return self._fernet.encrypt(value.encode("utf-8")).decode("ascii")

    def _decrypt_text(self, ciphertext: str) -> str | None:
        try:
            return self._fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
        except InvalidToken:
            return None

    def _encrypt_metadata(self, *, client_id: str, scopes: list[str]) -> str:
        payload = json.dumps({"client_id": client_id, "scopes": scopes}, separators=(",", ":"))
        return self._encrypt_text(payload)

    def _decrypt_metadata(self, ciphertext: str) -> dict[str, Any] | None:
        raw = self._decrypt_text(ciphertext)
        if raw is None:
            return None
        try:
            data = json.loads(raw)
        except ValueError:
            return None
        return data if isinstance(data, dict) else None

    def get_routes(self, mcp_path: str | None = None) -> list[Route]:
        base_routes = super().get_routes(mcp_path)
        routes: list[Route] = []

        for route in base_routes:
            if isinstance(route, Route) and route.path == "/.well-known/oauth-authorization-server":
                assert self.base_url is not None
                assert self.issuer_url is not None
                metadata = build_metadata(
                    self.base_url,
                    self.service_documentation_url,
                    self.client_registration_options or ClientRegistrationOptions(),
                    self.revocation_options or RevocationOptions(),
                )
                metadata.issuer = self.issuer_url
                metadata.scopes_supported = list(VALID_MCP_SCOPES)
                metadata.token_endpoint_auth_methods_supported = list(SUPPORTED_AUTH_METHODS)
                metadata.revocation_endpoint_auth_methods_supported = list(SUPPORTED_AUTH_METHODS)
                metadata_handler = MetadataHandler(metadata)
                routes.append(
                    Route(
                        path=route.path,
                        endpoint=cors_middleware(metadata_handler.handle, ["GET", "OPTIONS"]),
                        methods=route.methods or ["GET", "OPTIONS"],
                        name=route.name,
                        include_in_schema=route.include_in_schema,
                    )
                )
            elif isinstance(route, Route) and route.path == "/register":
                routes.append(
                    Route(
                        path=route.path,
                        endpoint=_PairingWindowGateASGI(route.app, self),
                        methods=route.methods,
                        name=route.name,
                        include_in_schema=route.include_in_schema,
                    )
                )
            else:
                routes.append(route)

        routes.append(
            Route(
                "/authorize/login",
                endpoint=self._handle_authorize_login,
                methods=["GET"],
                include_in_schema=False,
            )
        )
        routes.append(
            Route(
                "/authorize/approve",
                endpoint=self._handle_authorize_approve,
                methods=["POST"],
                include_in_schema=False,
            )
        )
        return routes

    def get_well_known_routes(self, mcp_path: str | None = None) -> list[Route]:
        routes = list(super().get_well_known_routes(mcp_path))
        has_bare_prm = any(
            isinstance(r, Route) and r.path == "/.well-known/oauth-protected-resource"
            for r in routes
        )
        if not has_bare_prm:
            for route in routes:
                if isinstance(route, Route) and route.path.startswith(
                    "/.well-known/oauth-protected-resource/"
                ):
                    routes.append(
                        Route(
                            path="/.well-known/oauth-protected-resource",
                            endpoint=route.endpoint,
                            methods=route.methods,
                            include_in_schema=False,
                        )
                    )
                    break
        return routes

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with get_session_maker()() as session:
            result = await session.execute(
                select(McpOAuthClient).where(McpOAuthClient.client_id == client_id)
            )
            row = result.scalar_one_or_none()
            if row is None or row.revoked_at is not None:
                return None

            client_secret: str | None = None
            if row.client_secret_encrypted is not None:
                client_secret = self._decrypt_text(row.client_secret_encrypted)
                if client_secret is None:
                    logger.warning(
                        "Failed to decrypt MCP OAuth client secret (key rotated?); rejecting client"
                    )
                    return None

            return OAuthClientInformationFull(
                client_id=row.client_id,
                client_secret=client_secret,
                client_id_issued_at=row.client_id_issued_at,
                client_secret_expires_at=row.client_secret_expires_at,
                client_name=row.client_name,
                token_endpoint_auth_method=row.token_endpoint_auth_method,  # type: ignore[arg-type]
                grant_types=list(row.grant_types),  # type: ignore[arg-type]
                response_types=list(row.response_types),  # type: ignore[arg-type]
                redirect_uris=[AnyUrl(uri) for uri in row.redirect_uris],
                scope=row.allowed_scopes,
            )

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if not self.is_pairing_window_open():
            raise RegistrationError(
                error="invalid_client_metadata",
                error_description="Pairing window is closed",
            )

        auth_method = client_info.token_endpoint_auth_method or "client_secret_post"
        if auth_method not in SUPPORTED_AUTH_METHODS:
            raise RegistrationError(
                error="invalid_client_metadata",
                error_description=(
                    f"Unsupported token_endpoint_auth_method '{auth_method}'. "
                    "Use 'none' or 'client_secret_post'."
                ),
            )

        redirect_uris = [str(uri) for uri in (client_info.redirect_uris or [])]
        if not redirect_uris:
            raise RegistrationError(
                error="invalid_redirect_uri",
                error_description="At least one redirect_uri is required",
            )
        allowed_patterns = self._settings.mcp_oauth_allowed_redirect_uris_list
        for uri in redirect_uris:
            if not is_redirect_uri_allowed(uri, allowed_patterns):
                raise RegistrationError(
                    error="invalid_redirect_uri",
                    error_description=f"redirect_uri '{uri}' is not in the configured allowlist",
                )

        if not client_info.client_id:
            raise RegistrationError(
                error="invalid_client_metadata",
                error_description="client_id is required",
            )

        requested_scopes = (
            client_info.scope.split() if client_info.scope else list(VALID_MCP_SCOPES)
        )
        if not requested_scopes or not set(requested_scopes).issubset(VALID_MCP_SCOPES):
            raise RegistrationError(
                error="invalid_client_metadata",
                error_description="Requested scopes must be a subset of read, log, manage",
            )

        encrypted_secret = (
            self._encrypt_text(client_info.client_secret) if client_info.client_secret else None
        )

        async with get_session_maker()() as session:
            active_count = await session.scalar(
                select(func.count())
                .select_from(McpOAuthClient)
                .where(McpOAuthClient.revoked_at.is_(None))
            )
            if (active_count or 0) >= self._settings.MCP_OAUTH_MAX_CLIENTS:
                raise RegistrationError(
                    error="invalid_client_metadata",
                    error_description="Maximum number of active MCP OAuth clients reached",
                )

            session.add(
                McpOAuthClient(
                    client_id=client_info.client_id,
                    client_name=client_info.client_name,
                    client_secret_encrypted=encrypted_secret,
                    token_endpoint_auth_method=auth_method,
                    grant_types=[
                        str(g) for g in (client_info.grant_types or ["authorization_code"])
                    ],
                    response_types=[str(r) for r in (client_info.response_types or ["code"])],
                    redirect_uris=redirect_uris,
                    allowed_scopes=" ".join(requested_scopes),
                    client_id_issued_at=client_info.client_id_issued_at or int(time.time()),
                    client_secret_expires_at=client_info.client_secret_expires_at,
                )
            )
            await session.commit()

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        if not client.client_id:
            raise AuthorizeError(error="invalid_request", error_description="client_id is required")

        resource = (params.resource or "").strip() if hasattr(params, "resource") else ""
        if not resource:
            resource = self._canonical_resource
        elif resource.rstrip("/") != self._canonical_resource.rstrip("/"):
            raise AuthorizeError(
                error="invalid_target",
                error_description=f"Resource must be '{self._canonical_resource}'",
            )
        else:
            resource = self._canonical_resource

        client_scopes = client.scope.split() if client.scope else list(VALID_MCP_SCOPES)
        requested_scopes = list(params.scopes) if params.scopes else list(client_scopes)
        if not requested_scopes or not set(requested_scopes).issubset(set(client_scopes)):
            raise AuthorizeError(
                error="invalid_scope",
                error_description="Requested scopes are not permitted for this client",
            )

        txn_id = secrets.token_urlsafe(24)
        self._pending_txns.set(
            txn_id,
            _PendingAuthorization(
                client_id=client.client_id,
                client_name=client.client_name,
                redirect_uri=str(params.redirect_uri),
                redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
                state=params.state,
                code_challenge=params.code_challenge,
                requested_scopes=requested_scopes,
                resource=resource,
            ),
            ttl_seconds=PENDING_TXN_TTL_SECONDS,
        )
        return f"{self._base_root}{MCP_MOUNT_PATH}/authorize/login?txn={txn_id}"

    async def _handle_authorize_login(self, request: Request) -> Response:
        txn_id = request.query_params.get("txn", "").strip()
        pending = self._pending_txns.get(txn_id) if txn_id else None
        if pending is None:
            return _render_error_html(
                "Authorization Expired",
                "This authorization request is invalid or has expired.",
                status_code=400,
            )

        csrf_token = secrets.token_urlsafe(32)
        response = _render_consent_html(
            txn_id=txn_id,
            csrf_token=csrf_token,
            pending=pending,
        )
        response.set_cookie(
            key=CSRF_COOKIE_NAME,
            value=csrf_token,
            max_age=PENDING_TXN_TTL_SECONDS,
            httponly=True,
            samesite="lax",
            secure=request.url.scheme == "https",
            path=CSRF_COOKIE_PATH,
        )
        return response

    async def _handle_authorize_approve(self, request: Request) -> Response:
        form = await request.form()
        txn_id = str(form.get("txn_id", "")).strip()
        csrf_form = str(form.get("csrf_token", "")).strip()
        decision = str(form.get("decision", "")).strip()
        email = str(form.get("email", "")).strip().lower()
        password = str(form.get("password", ""))
        selected_scopes = [str(s).strip() for s in form.getlist("scopes") if str(s).strip()]

        pending = self._pending_txns.get(txn_id) if txn_id else None
        if pending is None:
            return _render_error_html(
                "Authorization Expired",
                "This authorization request is invalid or has expired.",
                status_code=400,
            )

        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME, "")
        if not csrf_cookie or not csrf_form or not secrets.compare_digest(csrf_cookie, csrf_form):
            return _render_error_html(
                "Forbidden",
                "Invalid or missing CSRF token. Reload the authorization page and try again.",
                status_code=403,
            )

        if decision == "deny":
            self._pending_txns.pop(txn_id)
            redirect_url = construct_redirect_uri(
                pending.redirect_uri,
                error="access_denied",
                error_description="Owner denied authorization",
                state=pending.state,
            )
            return RedirectResponse(
                url=redirect_url,
                status_code=302,
                headers={"Cache-Control": "no-store"},
            )

        if decision != "approve":
            return _render_error_html(
                "Invalid Request",
                "Unknown authorization decision.",
                status_code=400,
            )

        allowed_for_txn = set(pending.requested_scopes) & set(VALID_MCP_SCOPES)
        if not selected_scopes or not set(selected_scopes).issubset(allowed_for_txn):
            return _render_error_html(
                "Invalid Scopes",
                "Select at least one valid permission scope to approve.",
                status_code=400,
            )

        ip_address = request.client.host if request.client else "unknown"
        async with get_session_maker()() as session:
            try:
                await login_rate_limit.check_rate_limit(session, email, ip_address)
            except RateLimitedError as exc:
                return _render_error_html(
                    "Too Many Attempts",
                    exc.detail,
                    status_code=429,
                )

            result = await session.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()
            valid = (
                user is not None
                and user.role == "admin"
                and user.disabled_at is None
                and verify_password(password, user.password_hash)
            )
            if not valid:
                await login_rate_limit.record_attempt(session, email, ip_address, succeeded=False)
                new_csrf = secrets.token_urlsafe(32)
                response = _render_consent_html(
                    txn_id=txn_id,
                    csrf_token=new_csrf,
                    pending=pending,
                    selected_scopes=selected_scopes,
                    email=email,
                    error_message="Invalid admin email or password.",
                    status_code=401,
                )
                response.set_cookie(
                    key=CSRF_COOKIE_NAME,
                    value=new_csrf,
                    max_age=PENDING_TXN_TTL_SECONDS,
                    httponly=True,
                    samesite="lax",
                    secure=request.url.scheme == "https",
                    path=CSRF_COOKIE_PATH,
                )
                return response

            assert user is not None
            await login_rate_limit.record_attempt(session, email, ip_address, succeeded=True)

        self._pending_txns.pop(txn_id)
        code = secrets.token_urlsafe(32)
        self._auth_codes.set(
            code,
            _StoredAuthCode(
                code=code,
                client_id=pending.client_id,
                user_id=user.id,
                scopes=selected_scopes,
                expires_at=time.time() + AUTH_CODE_TTL_SECONDS,
                code_challenge=pending.code_challenge,
                redirect_uri=pending.redirect_uri,
                redirect_uri_provided_explicitly=pending.redirect_uri_provided_explicitly,
                resource=pending.resource,
            ),
            ttl_seconds=AUTH_CODE_TTL_SECONDS,
        )
        redirect_url = construct_redirect_uri(
            pending.redirect_uri,
            code=code,
            state=pending.state,
        )
        return RedirectResponse(
            url=redirect_url,
            status_code=302,
            headers={"Cache-Control": "no-store"},
        )

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        stored = self._auth_codes.get(authorization_code)
        if stored is None or stored.client_id != client.client_id:
            return None
        return stored.to_sdk_model()

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        stored = self._auth_codes.pop(authorization_code.code)
        if stored is None or stored.client_id != client.client_id:
            raise TokenError(
                error="invalid_grant",
                error_description="Authorization code is invalid, expired, or already used",
            )

        now = utcnow()
        family_id = uuid.uuid4()
        access_raw = secrets.token_urlsafe(32)
        refresh_raw = secrets.token_urlsafe(48)
        access_expires = now + timedelta(seconds=self._settings.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS)
        refresh_expires = now + timedelta(days=self._settings.MCP_OAUTH_REFRESH_TOKEN_IDLE_DAYS)
        absolute_expires = now + timedelta(
            days=self._settings.MCP_OAUTH_REFRESH_TOKEN_ABSOLUTE_DAYS
        )
        scope_str = " ".join(stored.scopes)
        encrypted_metadata = self._encrypt_metadata(
            client_id=stored.client_id, scopes=stored.scopes
        )

        async with get_session_maker()() as session:
            session.add(
                McpOAuthToken(
                    token_hash=hash_oauth_token(access_raw),
                    token_type="access",
                    client_id=stored.client_id,
                    user_id=stored.user_id,
                    token_family_id=family_id,
                    scopes=scope_str,
                    resource=stored.resource,
                    encrypted_metadata=encrypted_metadata,
                    expires_at=access_expires,
                )
            )
            session.add(
                McpOAuthToken(
                    token_hash=hash_oauth_token(refresh_raw),
                    token_type="refresh",
                    client_id=stored.client_id,
                    user_id=stored.user_id,
                    token_family_id=family_id,
                    scopes=scope_str,
                    resource=stored.resource,
                    encrypted_metadata=encrypted_metadata,
                    expires_at=min(refresh_expires, absolute_expires),
                    absolute_expires_at=absolute_expires,
                )
            )
            await session.execute(delete(McpOAuthToken).where(McpOAuthToken.expires_at < now))
            await session.commit()

        return OAuthToken(
            access_token=access_raw,
            token_type="Bearer",
            expires_in=self._settings.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
            scope=scope_str,
            refresh_token=refresh_raw,
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        token_hash = hash_oauth_token(refresh_token)
        now = utcnow()
        async with get_session_maker()() as session:
            result = await session.execute(
                select(McpOAuthToken, McpOAuthClient)
                .join(McpOAuthClient, McpOAuthClient.client_id == McpOAuthToken.client_id)
                .where(
                    McpOAuthToken.token_hash == token_hash,
                    McpOAuthToken.token_type == "refresh",
                    McpOAuthToken.client_id == client.client_id,
                )
            )
            pair = result.one_or_none()
            if pair is None:
                return None
            token_row, client_row = pair

            if client_row.revoked_at is not None or token_row.revoked_at is not None:
                return None
            if token_row.expires_at <= now:
                return None
            if token_row.absolute_expires_at is not None and token_row.absolute_expires_at <= now:
                return None

            if self._decrypt_metadata(token_row.encrypted_metadata) is None:
                logger.warning(
                    "Failed to decrypt MCP refresh token metadata (key rotated?); rejecting"
                )
                return None

            if token_row.rotated_at is not None and (now - token_row.rotated_at) > timedelta(
                seconds=REFRESH_GRACE_WINDOW_SECONDS
            ):
                await session.execute(
                    update(McpOAuthToken)
                    .where(
                        McpOAuthToken.token_family_id == token_row.token_family_id,
                        McpOAuthToken.revoked_at.is_(None),
                    )
                    .values(revoked_at=now)
                )
                await session.commit()
                logger.warning(
                    "MCP refresh token replay detected; revoked token family",
                    extra={"oauth_client_id": token_row.client_id},
                )
                return None

            return _StoredRefreshToken(
                token=refresh_token,
                client_id=token_row.client_id,
                scopes=token_row.scopes.split(),
                expires_at=int(token_row.expires_at.timestamp()),
                resource=token_row.resource,
                token_id=token_row.id,
                token_family_id=token_row.token_family_id,
                absolute_expires_at=token_row.absolute_expires_at,
                rotated_at=token_row.rotated_at,
                user_id=token_row.user_id,
            )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        requested_scopes = scopes if scopes else list(refresh_token.scopes)
        if not set(requested_scopes).issubset(set(refresh_token.scopes)):
            raise TokenError(
                error="invalid_scope",
                error_description="Requested scopes exceed the original refresh token grant",
            )

        token_hash = hash_oauth_token(refresh_token.token)
        now = utcnow()
        async with get_session_maker()() as session:
            result = await session.execute(
                select(McpOAuthToken, McpOAuthClient)
                .join(McpOAuthClient, McpOAuthClient.client_id == McpOAuthToken.client_id)
                .where(
                    McpOAuthToken.token_hash == token_hash,
                    McpOAuthToken.token_type == "refresh",
                    McpOAuthToken.client_id == client.client_id,
                )
            )
            pair = result.one_or_none()
            if pair is None:
                raise TokenError(error="invalid_grant", error_description="Refresh token not found")
            token_row, client_row = pair

            if client_row.revoked_at is not None or token_row.revoked_at is not None:
                raise TokenError(error="invalid_grant", error_description="Refresh token revoked")
            if token_row.expires_at <= now or (
                token_row.absolute_expires_at is not None and token_row.absolute_expires_at <= now
            ):
                raise TokenError(error="invalid_grant", error_description="Refresh token expired")

            if token_row.rotated_at is None:
                token_row.rotated_at = now

            access_raw = secrets.token_urlsafe(32)
            refresh_raw = secrets.token_urlsafe(48)
            access_expires = now + timedelta(
                seconds=self._settings.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS
            )
            sliding_refresh_expires = now + timedelta(
                days=self._settings.MCP_OAUTH_REFRESH_TOKEN_IDLE_DAYS
            )
            absolute_expires = token_row.absolute_expires_at or (
                now + timedelta(days=self._settings.MCP_OAUTH_REFRESH_TOKEN_ABSOLUTE_DAYS)
            )
            new_refresh_expires = min(sliding_refresh_expires, absolute_expires)
            scope_str = " ".join(requested_scopes)
            encrypted_metadata = self._encrypt_metadata(
                client_id=token_row.client_id, scopes=requested_scopes
            )

            session.add(
                McpOAuthToken(
                    token_hash=hash_oauth_token(access_raw),
                    token_type="access",
                    client_id=token_row.client_id,
                    user_id=token_row.user_id,
                    token_family_id=token_row.token_family_id,
                    scopes=scope_str,
                    resource=token_row.resource,
                    encrypted_metadata=encrypted_metadata,
                    expires_at=access_expires,
                )
            )
            session.add(
                McpOAuthToken(
                    token_hash=hash_oauth_token(refresh_raw),
                    token_type="refresh",
                    client_id=token_row.client_id,
                    user_id=token_row.user_id,
                    token_family_id=token_row.token_family_id,
                    scopes=scope_str,
                    resource=token_row.resource,
                    encrypted_metadata=encrypted_metadata,
                    expires_at=new_refresh_expires,
                    absolute_expires_at=absolute_expires,
                )
            )
            if client_row.last_used_at is None or (now - client_row.last_used_at) > timedelta(
                seconds=LAST_USED_THROTTLE_SECONDS
            ):
                client_row.last_used_at = now

            await session.execute(delete(McpOAuthToken).where(McpOAuthToken.expires_at < now))
            await session.commit()

        return OAuthToken(
            access_token=access_raw,
            token_type="Bearer",
            expires_in=self._settings.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
            scope=scope_str,
            refresh_token=refresh_raw,
        )

    async def load_access_token(self, token: str) -> AccessToken | None:
        token_hash = hash_oauth_token(token)
        now = utcnow()
        async with get_session_maker()() as session:
            result = await session.execute(
                select(McpOAuthToken, McpOAuthClient)
                .join(McpOAuthClient, McpOAuthClient.client_id == McpOAuthToken.client_id)
                .where(
                    McpOAuthToken.token_hash == token_hash,
                    McpOAuthToken.token_type == "access",
                )
            )
            pair = result.one_or_none()
            if pair is None:
                return None
            token_row, client_row = pair

            if (
                client_row.revoked_at is not None
                or token_row.revoked_at is not None
                or token_row.expires_at <= now
            ):
                return None

            if self._decrypt_metadata(token_row.encrypted_metadata) is None:
                logger.warning(
                    "Failed to decrypt MCP access token metadata (key rotated?); rejecting"
                )
                return None

            if client_row.last_used_at is None or (now - client_row.last_used_at) > timedelta(
                seconds=LAST_USED_THROTTLE_SECONDS
            ):
                client_row.last_used_at = now
                await session.commit()

            scopes = token_row.scopes.split()
            if "manage" in scopes and "log" not in scopes:
                scopes.append("log")

            return AccessToken(
                token=token,
                client_id=token_row.client_id,
                scopes=scopes,
                expires_at=int(token_row.expires_at.timestamp()),
                resource=token_row.resource,
                claims={
                    "sub": str(token_row.user_id),
                    "user_id": str(token_row.user_id),
                    "client_name": client_row.client_name,
                },
            )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        token_hash = hash_oauth_token(token.token)
        now = utcnow()
        async with get_session_maker()() as session:
            result = await session.execute(
                select(McpOAuthToken).where(McpOAuthToken.token_hash == token_hash)
            )
            token_row = result.scalar_one_or_none()
            if token_row is None:
                return
            if token_row.token_type == "refresh":
                await session.execute(
                    update(McpOAuthToken)
                    .where(
                        McpOAuthToken.token_family_id == token_row.token_family_id,
                        McpOAuthToken.revoked_at.is_(None),
                    )
                    .values(revoked_at=now)
                )
            elif token_row.revoked_at is None:
                token_row.revoked_at = now
            await session.commit()

    async def revoke_client(self, session: AsyncSession, client_id: str) -> bool:
        """Immediately revoke a client and all its tokens in one transaction."""
        result = await session.execute(
            select(McpOAuthClient).where(McpOAuthClient.client_id == client_id)
        )
        client_row = result.scalar_one_or_none()
        if client_row is None or client_row.revoked_at is not None:
            return False

        now = utcnow()
        client_row.revoked_at = now
        await session.execute(
            update(McpOAuthToken)
            .where(
                McpOAuthToken.client_id == client_id,
                McpOAuthToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        await session.commit()
        return True


class SubjectAllowlistAuth(AuthProvider):
    """Wraps a verified-token provider with a stable-subject allowlist."""

    def __init__(self, delegate: AuthProvider, allowed_subjects: set[str]) -> None:
        super().__init__(
            base_url=delegate.base_url,
            required_scopes=delegate.required_scopes,
            resource_base_url=delegate.resource_base_url,
        )
        self._delegate = delegate
        self._allowed_subjects = allowed_subjects

    async def verify_token(self, token: str) -> AccessToken | None:
        access = await self._delegate.verify_token(token)
        if access is None:
            return None
        subject = access.subject or access.claims.get("sub")
        if not subject or subject not in self._allowed_subjects:
            logger.warning("Rejected MCP OAuth token for non-allowlisted subject")
            return None
        return access

    def set_mcp_path(self, mcp_path: str | None) -> None:
        super().set_mcp_path(mcp_path)
        self._delegate.set_mcp_path(mcp_path)

    def get_routes(self, mcp_path: str | None = None) -> list[Any]:
        return self._delegate.get_routes(mcp_path)

    def get_well_known_routes(self, mcp_path: str | None = None) -> list[Any]:
        return self._delegate.get_well_known_routes(mcp_path)


def _build_client_storage(settings: Settings):
    if not settings.MCP_OAUTH_STORAGE_KEY:
        raise ValueError("MCP_OAUTH_STORAGE_KEY must be set when MCP_OAUTH_ENABLED=true")
    store = FileTreeStore(data_directory=Path(settings.MCP_OAUTH_STORAGE_DIR))
    return FernetEncryptionWrapper(
        store,
        source_material=settings.MCP_OAUTH_STORAGE_KEY,
        salt=MCP_OAUTH_STORAGE_SALT,
    )


OIDC_DISCOVERY_SUFFIX = "/.well-known/openid-configuration"


def auth0_config_url(issuer: str) -> str:
    base = issuer.rstrip("/")
    return base if base.endswith(OIDC_DISCOVERY_SUFFIX) else f"{base}{OIDC_DISCOVERY_SUFFIX}"


class _Auth0Proxy(Auth0Provider):
    def _build_upstream_authorize_url(self, txn_id: str, transaction: dict[str, Any]) -> str:
        scopes = list(transaction.get("scopes") or MCP_CLIENT_SCOPES)
        if "offline_access" not in scopes:
            scopes.append("offline_access")
        return super()._build_upstream_authorize_url(txn_id, {**transaction, "scopes": scopes})


def _build_auth0_provider(settings: Settings) -> AuthProvider:
    assert settings.MCP_OAUTH_ISSUER
    assert settings.MCP_OAUTH_CLIENT_ID
    assert settings.MCP_OAUTH_CLIENT_SECRET
    assert settings.MCP_OAUTH_AUDIENCE
    base_url = settings.mcp_oauth_base_url_resolved
    provider = _Auth0Proxy(
        config_url=auth0_config_url(settings.MCP_OAUTH_ISSUER),
        client_id=settings.MCP_OAUTH_CLIENT_ID,
        client_secret=settings.MCP_OAUTH_CLIENT_SECRET,
        audience=settings.MCP_OAUTH_AUDIENCE,
        base_url=f"{base_url}{MCP_MOUNT_PATH}",
        resource_base_url=f"{base_url}{MCP_MOUNT_PATH}",
        issuer_url=base_url,
        required_scopes=[],
        jwt_signing_key=settings.MCP_OAUTH_JWT_SIGNING_KEY,
        client_storage=_build_client_storage(settings),
    )
    provider.update_default_scopes(MCP_CLIENT_SCOPES)
    return provider


def _build_jwt_provider(settings: Settings) -> AuthProvider:
    assert settings.MCP_OAUTH_ISSUER
    assert settings.MCP_OAUTH_AUDIENCE
    base_url = settings.mcp_oauth_base_url_resolved
    verifier = JWTVerifier(
        jwks_uri=settings.MCP_OAUTH_JWKS_URI,
        public_key=settings.MCP_OAUTH_JWT_PUBLIC_KEY,
        issuer=settings.MCP_OAUTH_ISSUER,
        audience=settings.MCP_OAUTH_AUDIENCE,
        required_scopes=[],
    )
    return RemoteAuthProvider(
        token_verifier=verifier,
        authorization_servers=[AnyHttpUrl(settings.MCP_OAUTH_ISSUER)],
        base_url=f"{base_url}{MCP_MOUNT_PATH}",
        resource_base_url=f"{base_url}{MCP_MOUNT_PATH}",
        scopes_supported=MCP_CLIENT_SCOPES,
    )


def unwrap_local_oauth_provider(auth: Any) -> SingleOwnerOAuthProvider | None:
    """Return the active `SingleOwnerOAuthProvider` if mounted (unwrapping
    `ApiKeyOrOAuthAuth` when API token auth is also enabled)."""
    current = auth
    while current is not None:
        if isinstance(current, SingleOwnerOAuthProvider):
            return current
        current = getattr(current, "_delegate", None)
    return None


def build_mcp_auth(settings: Settings) -> AuthProvider | None:
    """OAuth, API tokens, or both (app/mcp/api_key_auth.py). `None` when
    disabled or when both are off."""
    if settings.MCP_MODE == "disabled":
        return None
    oauth = build_mcp_oauth_provider(settings)
    if not settings.MCP_API_KEY_AUTH_ENABLED:
        return oauth
    from app.mcp.api_key_auth import ApiKeyOrOAuthAuth, ApiTokenVerifier

    base_url = f"{settings.mcp_oauth_base_url_resolved}{MCP_MOUNT_PATH}"
    return ApiKeyOrOAuthAuth(
        oauth,
        ApiTokenVerifier(base_url=base_url, resource_base_url=base_url),
        base_url,
    )


def build_mcp_oauth_provider(settings: Settings) -> AuthProvider | None:
    """Build the MCP auth provider from settings, or `None` when OAuth is
    disabled."""
    if settings.MCP_MODE == "disabled" or not settings.MCP_OAUTH_ENABLED:
        return None

    if settings.MCP_OAUTH_PROVIDER == "local":
        return SingleOwnerOAuthProvider(settings)
    if settings.MCP_OAUTH_PROVIDER == "jwt":
        delegate = _build_jwt_provider(settings)
    elif settings.MCP_OAUTH_PROVIDER == "auth0":
        delegate = _build_auth0_provider(settings)
    else:  # pragma: no cover - guarded by Settings validation
        raise ValueError(f"Unknown MCP_OAUTH_PROVIDER {settings.MCP_OAUTH_PROVIDER!r}")

    return SubjectAllowlistAuth(delegate, settings.mcp_oauth_allowed_subjects_set)
