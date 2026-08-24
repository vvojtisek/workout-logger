from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.exceptions import RateLimitedError
from app.models import LoginAttempt
from app.models.base import utcnow


async def _recent_failures(session: AsyncSession, column, value: str, window_minutes: int) -> int:
    since = utcnow() - timedelta(minutes=window_minutes)
    count = await session.scalar(
        select(func.count())
        .select_from(LoginAttempt)
        .where(
            column == value,
            LoginAttempt.succeeded.is_(False),
            LoginAttempt.created_at >= since,
        )
    )
    return count or 0


async def check_rate_limit(session: AsyncSession, email: str, ip_address: str) -> None:
    """Counts recent failures per-email and per-IP independently (both DB-backed,
    so this is correct across replicas): blocks credential stuffing against one
    account and single-IP brute force, without one bad actor on a shared IP
    locking out everyone else behind it."""
    settings = get_settings()
    window = settings.LOGIN_RATE_LIMIT_WINDOW_MINUTES
    max_attempts = settings.LOGIN_RATE_LIMIT_MAX_ATTEMPTS

    email_failures = await _recent_failures(session, LoginAttempt.email_normalized, email, window)
    if email_failures >= max_attempts:
        raise RateLimitedError("Too many login attempts for this account. Try again later.")

    ip_failures = await _recent_failures(session, LoginAttempt.ip_address, ip_address, window)
    if ip_failures >= max_attempts:
        raise RateLimitedError("Too many login attempts from this address. Try again later.")


async def record_attempt(
    session: AsyncSession, email: str, ip_address: str, succeeded: bool
) -> None:
    session.add(LoginAttempt(email_normalized=email, ip_address=ip_address, succeeded=succeeded))
    await session.commit()
