"""OAuth 2.1 authentication for the MCP transport.

ChatGPT and other MCP clients authenticate with `Authorization: Bearer
<access_token>` rather than the REST API's `X-API-Key`. FastMCP supplies the
OAuth 2.1 + PKCE authorization-server proxy, RFC 9728 protected-resource
metadata, and the 401/WWW-Authenticate challenge natively; this module only
adds the two things specific to this deployment:

1. A stable-subject allowlist (`SubjectAllowlistAuth`) -- this is a private,
   single-user application, so a valid upstream identity is necessary but not
   sufficient.
2. The choice between two verifier backends, selected by
   `MCP_OAUTH_PROVIDER`:
   - "auth0" (production default): FastMCP's `Auth0Provider`, an OAuth proxy
     that bridges MCP clients requiring Dynamic Client Registration (like
     ChatGPT) to a single pre-registered confidential Auth0 application.
   - "jwt": a plain resource-server `JWTVerifier` against a known issuer's
     JWKS/public key, with no registration bridging. Used by the automated
     test suite (no network calls, deterministic tokens) and available as a
     lighter-weight production option for issuers that already support
     public-client PKCE without a bridge.

Scope enforcement (`read` / `log`) is done per-tool via FastMCP's native
component-level `auth=require_scopes(...)`, not here -- see `app/mcp/server.py`.
"""

from pathlib import Path
from typing import Any

from fastmcp.server.auth import AccessToken, AuthProvider, RemoteAuthProvider
from fastmcp.server.auth.providers.auth0 import Auth0Provider
from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.utilities.logging import get_logger
from key_value.aio.stores.filetree import FileTreeStore
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper
from pydantic import AnyHttpUrl

from app.config import Settings

logger = get_logger(__name__)

MCP_MOUNT_PATH = "/mcp"
MCP_OAUTH_STORAGE_SALT = "workout-logger-mcp-oauth-v1"


class SubjectAllowlistAuth(AuthProvider):
    """Wraps a verified-token provider with a stable-subject allowlist.

    A token that verifies successfully against the upstream IdP is
    necessary but not sufficient: this is a private, single-user/family
    application, so the resolved `sub` claim must also appear in
    `MCP_OAUTH_ALLOWED_SUBJECTS`. Rejection returns `None` from
    `verify_token`, which FastMCP surfaces as a standard 401 challenge --
    it is indistinguishable from an invalid token, so it does not leak
    which identities are allowlisted.
    """

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
    """Persistent, encrypted-at-rest storage for OAuth-proxy state (client
    registrations, encrypted upstream/refresh tokens) so pod restarts and
    redeployments don't force every MCP client to re-register and
    re-authorize. Lives on the same persistent volume as the SQLite
    database (`MCP_OAUTH_STORAGE_DIR`, defaulting to a subdirectory of
    `/data`), so it survives across restarts on the single-replica
    deployment the same way the database file does.
    """
    if not settings.MCP_OAUTH_STORAGE_KEY:
        raise ValueError("MCP_OAUTH_STORAGE_KEY must be set when MCP_OAUTH_ENABLED=true")
    store = FileTreeStore(data_directory=Path(settings.MCP_OAUTH_STORAGE_DIR))
    return FernetEncryptionWrapper(
        store,
        source_material=settings.MCP_OAUTH_STORAGE_KEY,
        salt=MCP_OAUTH_STORAGE_SALT,
    )


def _build_auth0_provider(settings: Settings) -> AuthProvider:
    assert settings.MCP_OAUTH_ISSUER
    assert settings.MCP_OAUTH_CLIENT_ID
    assert settings.MCP_OAUTH_CLIENT_SECRET
    assert settings.MCP_OAUTH_AUDIENCE
    base_url = settings.mcp_oauth_base_url_resolved
    return Auth0Provider(
        config_url=settings.MCP_OAUTH_ISSUER,
        client_id=settings.MCP_OAUTH_CLIENT_ID,
        client_secret=settings.MCP_OAUTH_CLIENT_SECRET,
        audience=settings.MCP_OAUTH_AUDIENCE,
        # Operational routes (/authorize, /token, /register) live under the
        # same mount as the MCP transport itself.
        base_url=f"{base_url}{MCP_MOUNT_PATH}",
        # The canonical resource identifier is the externally reachable MCP
        # endpoint, with a trailing slash: https://.../mcp/.
        resource_base_url=f"{base_url}{MCP_MOUNT_PATH}",
        # Root-level issuer so well-known discovery metadata is emitted
        # without a path suffix; see app/main.py for why it must also be
        # mounted at the application root rather than under /mcp.
        issuer_url=base_url,
        required_scopes=[],
        jwt_signing_key=settings.MCP_OAUTH_JWT_SIGNING_KEY,
        client_storage=_build_client_storage(settings),
    )


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
        scopes_supported=["read", "log"],
    )


def build_mcp_oauth_provider(settings: Settings) -> AuthProvider | None:
    """Build the MCP auth provider from settings, or `None` when OAuth is
    disabled (local development only -- the MCP mount then has no auth at
    all, so this must never be left enabled in production)."""
    if not settings.MCP_OAUTH_ENABLED:
        return None

    if settings.MCP_OAUTH_PROVIDER == "jwt":
        delegate = _build_jwt_provider(settings)
    elif settings.MCP_OAUTH_PROVIDER == "auth0":
        delegate = _build_auth0_provider(settings)
    else:  # pragma: no cover - guarded by Settings validation
        raise ValueError(f"Unknown MCP_OAUTH_PROVIDER {settings.MCP_OAUTH_PROVIDER!r}")

    return SubjectAllowlistAuth(delegate, settings.mcp_oauth_allowed_subjects_set)
