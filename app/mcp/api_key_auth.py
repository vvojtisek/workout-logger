"""API-token authentication for the MCP transport, beside OAuth.

Clients that cannot run an OAuth flow (Claude Code, Gemini CLI, scripts)
send one of the app's own API tokens (`wl_...`, Settings > API tokens) as
`Authorization: Bearer wl_...` or `X-API-Key: wl_...`. Tokens with the `wl_`
prefix are checked against `api_tokens` by hash; every other bearer goes to
the OAuth verifier unchanged. The bootstrap `API_KEY` is never accepted
here: it has global data access and must not sit in an LLM vendor's
connector settings.
"""

from typing import Any

from fastmcp.server.auth import AccessToken, AuthProvider, TokenVerifier
from sqlalchemy import select
from starlette.types import ASGIApp, Receive, Scope, Send

from app.database import get_session_maker
from app.models import ApiToken
from app.models.base import utcnow
from app.token_hash import hash_token

API_TOKEN_PREFIX = "wl_"
API_TOKEN_AUTH = "api_token"
# What an MCP tool checks (app/mcp/server.py). An admin-scoped token gets
# both, never more: there is no admin tool on MCP.
_MCP_SCOPES = ("read", "log")


def _mcp_scopes(stored: str) -> list[str]:
    scopes = {scope.strip() for scope in stored.split(",") if scope.strip()}
    if "admin" in scopes:
        return list(_MCP_SCOPES)
    return [scope for scope in _MCP_SCOPES if scope in scopes]


class ApiTokenVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        if not token.startswith(API_TOKEN_PREFIX):
            return None
        async with get_session_maker()() as session:
            row = await session.scalar(
                select(ApiToken).where(ApiToken.token_hash == hash_token(token))
            )
            if row is None or row.revoked_at is not None:
                return None
            row.last_used_at = utcnow()
            await session.commit()
            return AccessToken(
                token=token,
                client_id=f"api-token:{row.name}",
                scopes=_mcp_scopes(row.scopes),
                expires_at=None,
                claims={
                    "auth": API_TOKEN_AUTH,
                    "token_id": str(row.id),
                    "owner_id": str(row.owner_id) if row.owner_id is not None else None,
                },
            )


class ApiKeyOrOAuthAuth(AuthProvider):
    """Routes `wl_` bearers to the API-token verifier and everything else to
    the OAuth provider (when OAuth is enabled). OAuth routes and discovery
    metadata come from the OAuth provider only."""

    def __init__(
        self, oauth: AuthProvider | None, api_tokens: ApiTokenVerifier, base_url: str
    ) -> None:
        super().__init__(
            base_url=oauth.base_url if oauth is not None else base_url,
            required_scopes=oauth.required_scopes if oauth is not None else [],
            resource_base_url=oauth.resource_base_url if oauth is not None else base_url,
        )
        # Named like SubjectAllowlistAuth's, so app/mcp/audit.py can unwrap it.
        self._delegate = oauth
        self._api_tokens = api_tokens

    async def verify_token(self, token: str) -> AccessToken | None:
        if token.startswith(API_TOKEN_PREFIX):
            return await self._api_tokens.verify_token(token)
        if self._delegate is None:
            return None
        return await self._delegate.verify_token(token)

    @property
    def scopes_supported(self) -> list[str]:
        if self._delegate is not None:
            return self._delegate.scopes_supported
        return list(_MCP_SCOPES)

    def set_mcp_path(self, mcp_path: str | None) -> None:
        super().set_mcp_path(mcp_path)
        self._api_tokens.set_mcp_path(mcp_path)
        if self._delegate is not None:
            self._delegate.set_mcp_path(mcp_path)

    def get_routes(self, mcp_path: str | None = None) -> list[Any]:
        return self._delegate.get_routes(mcp_path) if self._delegate is not None else []

    def get_well_known_routes(self, mcp_path: str | None = None) -> list[Any]:
        if self._delegate is None:
            return []
        return self._delegate.get_well_known_routes(mcp_path)


class ApiKeyHeaderAdapter:
    """Lets a client send `X-API-Key: wl_...` instead of a bearer header, the
    way the REST API and GPT Actions already do. An explicit Authorization
    header always wins; only `wl_` tokens are rewritten."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = list(scope.get("headers", []))
            names = {name for name, _ in headers}
            if b"authorization" not in names:
                key = next((value for name, value in headers if name == b"x-api-key"), None)
                if key is not None and key.startswith(API_TOKEN_PREFIX.encode()):
                    headers.append((b"authorization", b"Bearer " + key))
                    scope = {**scope, "headers": headers}
        await self.app(scope, receive, send)
