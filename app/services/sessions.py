import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import User, UserSession
from app.models.base import utcnow
from app.security import hash_token

_TOKEN_PREFIX = "sess_"
_PREFIX_DISPLAY_LEN = 10


def _generate_raw_token() -> str:
    return f"{_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


async def create_session(
    session: AsyncSession, user: User, user_agent: str | None, ip_address: str | None
) -> tuple[UserSession, str]:
    settings = get_settings()
    raw_token = _generate_raw_token()
    now = utcnow()
    user_session = UserSession(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        token_prefix=raw_token[:_PREFIX_DISPLAY_LEN],
        expires_at=now + timedelta(days=settings.SESSION_ABSOLUTE_TTL_DAYS),
        last_seen_at=now,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    session.add(user_session)
    await session.commit()
    await session.refresh(user_session)
    return user_session, raw_token


async def resolve_session(session: AsyncSession, raw_token: str) -> User | None:
    """Returns the session's user if the token is valid, unexpired, and
    hasn't gone idle -- None otherwise. Bumps `last_seen_at` on success,
    which is what makes the idle timeout sliding rather than fixed."""
    settings = get_settings()
    result = await session.execute(
        select(UserSession).where(UserSession.token_hash == hash_token(raw_token))
    )
    user_session = result.scalar_one_or_none()
    if user_session is None or user_session.revoked_at is not None:
        return None

    now = utcnow()
    if user_session.expires_at <= now:
        return None
    idle_cutoff = user_session.last_seen_at + timedelta(
        minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES
    )
    if idle_cutoff <= now:
        return None

    user_result = await session.execute(select(User).where(User.id == user_session.user_id))
    user = user_result.scalar_one_or_none()
    if user is None or user.disabled_at is not None:
        return None

    user_session.last_seen_at = now
    await session.commit()
    return user


async def revoke_session(session: AsyncSession, raw_token: str) -> None:
    result = await session.execute(
        select(UserSession).where(UserSession.token_hash == hash_token(raw_token))
    )
    user_session = result.scalar_one_or_none()
    if user_session is not None and user_session.revoked_at is None:
        user_session.revoked_at = utcnow()
        await session.commit()
