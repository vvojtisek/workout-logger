import hashlib
import secrets

from fastapi import Depends, Request, Security
from fastapi.security import APIKeyHeader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException

from app.config import get_settings
from app.database import get_session
from app.models import ApiToken
from app.models.base import utcnow

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

# GET/HEAD/OPTIONS only ever read state, so a `read`-scoped token suffices.
# Every other method mutates or logs something, which needs `log` (or `admin`).
_READ_METHODS = {"GET", "HEAD", "OPTIONS"}


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


class AuthContext:
    """Resolved identity for one authenticated request: either the bootstrap
    `API_KEY` (always treated as full-access `admin`) or a DB-backed
    `ApiToken`'s scopes."""

    def __init__(self, scopes: set[str], token: ApiToken | None) -> None:
        self.scopes = scopes
        self.token = token

    def has_scope(self, scope: str) -> bool:
        return "admin" in self.scopes or scope in self.scopes


async def _resolve_db_token(session: AsyncSession, api_key: str) -> ApiToken | None:
    token_hash = hash_token(api_key)
    result = await session.execute(select(ApiToken).where(ApiToken.token_hash == token_hash))
    token = result.scalar_one_or_none()
    if token is None or token.revoked_at is not None:
        return None
    token.last_used_at = utcnow()
    await session.commit()
    return token


async def _authenticate(api_key: str | None, session: AsyncSession) -> AuthContext:
    settings = get_settings()
    if not api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

    if secrets.compare_digest(api_key, settings.API_KEY):
        return AuthContext(scopes={"admin"}, token=None)

    token = await _resolve_db_token(session, api_key)
    if token is not None:
        return AuthContext(scopes=set(token.scopes.split(",")), token=token)

    raise HTTPException(status_code=401, detail="Invalid or missing API key")


async def require_api_key(
    request: Request,
    api_key: str | None = Security(api_key_header),
    session: AsyncSession = Depends(get_session),
) -> AuthContext:
    auth = await _authenticate(api_key, session)
    required_scope = "read" if request.method in _READ_METHODS else "log"
    if not auth.has_scope(required_scope):
        raise HTTPException(
            status_code=403, detail=f"Token is missing the required '{required_scope}' scope"
        )
    return auth


async def require_admin(auth: AuthContext = Security(require_api_key)) -> AuthContext:
    if not auth.has_scope("admin"):
        raise HTTPException(status_code=403, detail="Token is missing the required 'admin' scope")
    return auth
