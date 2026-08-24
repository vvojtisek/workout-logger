import secrets
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import ApiToken
from app.models.base import utcnow
from app.schemas.api_tokens import ApiTokenCreate
from app.security import hash_token

_TOKEN_PREFIX = "wl_"
_PREFIX_DISPLAY_LEN = 10  # "wl_" plus a handful of chars, enough to recognize a token in a list


def _generate_raw_token() -> str:
    return f"{_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


async def list_api_tokens(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[ApiToken], int]:
    total = await session.scalar(select(func.count()).select_from(ApiToken))
    result = await session.execute(
        select(ApiToken).order_by(ApiToken.created_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_api_token(session: AsyncSession, token_id: UUID) -> ApiToken:
    result = await session.execute(select(ApiToken).where(ApiToken.id == token_id))
    token = result.scalar_one_or_none()
    if token is None:
        raise NotFoundError("API token not found", code="API_TOKEN_NOT_FOUND")
    return token


async def create_api_token(session: AsyncSession, data: ApiTokenCreate) -> tuple[ApiToken, str]:
    raw_token = _generate_raw_token()
    token = ApiToken(
        name=data.name,
        scopes=",".join(data.scopes),
        token_hash=hash_token(raw_token),
        token_prefix=raw_token[:_PREFIX_DISPLAY_LEN],
    )
    session.add(token)
    await session.commit()
    await session.refresh(token)
    return token, raw_token


async def revoke_api_token(session: AsyncSession, token_id: UUID) -> ApiToken:
    token = await get_api_token(session, token_id)
    if token.revoked_at is None:
        token.revoked_at = utcnow()
        await session.commit()
        await session.refresh(token)
    return token
