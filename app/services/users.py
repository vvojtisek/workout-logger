import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.exceptions import NotFoundError
from app.models import AccountToken, User
from app.models.base import utcnow
from app.token_hash import hash_token

_RESET_TOKEN_PREFIX = "rst_"
_PREFIX_DISPLAY_LEN = 10


def _generate_raw_token() -> str:
    return f"{_RESET_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


async def list_users(session: AsyncSession, limit: int, offset: int) -> tuple[list[User], int]:
    total = await session.scalar(select(func.count()).select_from(User))
    result = await session.execute(
        select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_user(session: AsyncSession, user_id: UUID) -> User:
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise NotFoundError("User not found", code="USER_NOT_FOUND")
    return user


async def revoke_user(session: AsyncSession, user_id: UUID) -> User:
    """Disables the account so it can no longer log in. Does not yet revoke
    existing sessions or API tokens -- that lands once those exist (slices 2/3/7)."""
    user = await get_user(session, user_id)
    if user.disabled_at is None:
        user.disabled_at = utcnow()
        await session.commit()
        await session.refresh(user)
    return user


async def issue_password_reset(
    session: AsyncSession, user_id: UUID, issued_by: UUID | None
) -> tuple[AccountToken, str]:
    user = await get_user(session, user_id)
    settings = get_settings()
    raw_token = _generate_raw_token()
    token = AccountToken(
        purpose="password_reset",
        user_id=user.id,
        issued_by=issued_by,
        token_hash=hash_token(raw_token),
        token_prefix=raw_token[:_PREFIX_DISPLAY_LEN],
        expires_at=utcnow() + timedelta(hours=settings.PASSWORD_RESET_TTL_HOURS),
    )
    session.add(token)
    await session.commit()
    await session.refresh(token)
    return token, raw_token
