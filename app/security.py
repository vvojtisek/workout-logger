import secrets
from uuid import UUID

from fastapi import Depends, Request, Security
from fastapi.security import APIKeyHeader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException

from app.config import get_settings
from app.database import get_session
from app.models import ApiToken, User
from app.models.base import utcnow
from app.services.sessions import resolve_session
from app.token_hash import hash_token

__all__ = [
    "AuthContext",
    "hash_token",
    "require_account_admin",
    "require_admin",
    "require_api_key",
]

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

# GET/HEAD/OPTIONS only ever read state, so a `read`-scoped token suffices.
# Every other method mutates or logs something, which needs `log` (or `admin`).
_READ_METHODS = {"GET", "HEAD", "OPTIONS"}


class AuthContext:
    """Resolved identity for one authenticated request: the bootstrap
    `API_KEY` (always treated as full-access `admin`), a DB-backed
    `ApiToken`'s scopes, or a session cookie's `User`. A session is always
    scoped `{"read", "log"}` -- never `{"admin"}` -- so a logged-in account
    admin does not silently inherit unrestricted cross-user data access via
    `has_scope()`'s "admin bypasses everything" rule. Account-admin
    authorization is a separate check: see `require_account_admin`."""

    def __init__(self, scopes: set[str], token: ApiToken | None, user: User | None = None) -> None:
        self.scopes = scopes
        self.token = token
        self.user = user

    def has_scope(self, scope: str) -> bool:
        return "admin" in self.scopes or scope in self.scopes

    @property
    def owner_id(self) -> UUID | None:
        return self.user.id if self.user is not None else None


async def _resolve_db_token(session: AsyncSession, api_key: str) -> ApiToken | None:
    token_hash = hash_token(api_key)
    result = await session.execute(select(ApiToken).where(ApiToken.token_hash == token_hash))
    token = result.scalar_one_or_none()
    if token is None or token.revoked_at is not None:
        return None
    token.last_used_at = utcnow()
    await session.commit()
    return token


async def authenticate_request(
    request: Request, api_key: str | None, session: AsyncSession
) -> AuthContext:
    """Resolve the caller's identity, raising 401 when it can't be resolved.
    An `X-API-Key` header takes priority (unchanged bootstrap-key/DB-token
    behavior); with no header, falls back to the session cookie. Shared by
    the REST dependency below and the MCP transport in `app/mcp/`."""
    settings = get_settings()
    if api_key:
        if secrets.compare_digest(api_key, settings.API_KEY):
            return AuthContext(scopes={"admin"}, token=None)

        token = await _resolve_db_token(session, api_key)
        if token is not None:
            return AuthContext(scopes=set(token.scopes.split(",")), token=token)

        raise HTTPException(status_code=401, detail="Invalid or missing API key")

    raw_session_token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if raw_session_token:
        user = await resolve_session(session, raw_session_token)
        if user is not None:
            return AuthContext(scopes={"read", "log"}, token=None, user=user)

    raise HTTPException(status_code=401, detail="Invalid or missing API key")


async def require_api_key(
    request: Request,
    api_key: str | None = Security(api_key_header),
    session: AsyncSession = Depends(get_session),
) -> AuthContext:
    auth = await authenticate_request(request, api_key, session)
    required_scope = "read" if request.method in _READ_METHODS else "log"
    if not auth.has_scope(required_scope):
        raise HTTPException(
            status_code=403, detail=f"Token is missing the required '{required_scope}' scope"
        )
    return auth


async def require_admin(auth: AuthContext = Security(require_api_key)) -> AuthContext:
    """Token-scope admin (bootstrap `API_KEY` or an admin-scoped `ApiToken`),
    OR a session-authenticated account admin -- account admins are allowed to
    manage invites, users, and API tokens (including issuing tokens on behalf
    of other users), which is exactly what this dependency gates."""
    if auth.has_scope("admin") or (auth.user is not None and auth.user.role == "admin"):
        return auth
    raise HTTPException(status_code=403, detail="Token is missing the required 'admin' scope")


async def require_account_admin(auth: AuthContext = Security(require_api_key)) -> AuthContext:
    """Strictly a session-authenticated account admin -- unlike `require_admin`,
    a token-scope `admin` (bootstrap key or admin-scoped `ApiToken`) does NOT
    satisfy this. For routes that must only ever be reachable by a real,
    logged-in account admin."""
    if auth.user is None or auth.user.role != "admin":
        raise HTTPException(status_code=403, detail="Account admin role required")
    return auth
