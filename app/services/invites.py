import secrets
from datetime import timedelta
from typing import cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.exceptions import ConflictError, NotFoundError
from app.models import AccountToken, User
from app.models.base import utcnow
from app.schemas.invites import AcceptInviteRequest, InviteCreate, InviteRead, InviteStatus
from app.schemas.users import Role
from app.token_hash import hash_token
from app.security_passwords import hash_password

_TOKEN_PREFIX = "inv_"
_PREFIX_DISPLAY_LEN = 10


def _generate_raw_token() -> str:
    return f"{_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def _invite_status(token: AccountToken) -> InviteStatus:
    if token.revoked_at is not None:
        return "revoked"
    if token.used_at is not None:
        return "accepted"
    if token.expires_at <= utcnow():
        return "expired"
    return "pending"


def invite_to_read(token: AccountToken) -> InviteRead:
    return InviteRead(
        id=token.id,
        email=token.email or "",
        role=cast(Role, token.role or "user"),
        status=_invite_status(token),
        expires_at=token.expires_at,
        used_at=token.used_at,
        revoked_at=token.revoked_at,
        created_at=token.created_at,
    )


async def _has_pending_invite(session: AsyncSession, email: str) -> bool:
    result = await session.execute(
        select(AccountToken).where(
            AccountToken.purpose == "invite",
            AccountToken.email == email,
            AccountToken.used_at.is_(None),
            AccountToken.revoked_at.is_(None),
            AccountToken.expires_at > utcnow(),
        )
    )
    return result.scalar_one_or_none() is not None


async def _user_exists(session: AsyncSession, email: str) -> bool:
    result = await session.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none() is not None


async def create_invite(
    session: AsyncSession, data: InviteCreate, issued_by: UUID | None
) -> tuple[AccountToken, str]:
    if await _user_exists(session, data.email):
        raise ConflictError("A user with this email already exists", code="EMAIL_IN_USE")
    if await _has_pending_invite(session, data.email):
        raise ConflictError("A pending invite already exists for this email", code="INVITE_PENDING")

    settings = get_settings()
    raw_token = _generate_raw_token()
    token = AccountToken(
        purpose="invite",
        email=data.email,
        role=data.role,
        issued_by=issued_by,
        token_hash=hash_token(raw_token),
        token_prefix=raw_token[:_PREFIX_DISPLAY_LEN],
        expires_at=utcnow() + timedelta(hours=settings.INVITE_TTL_HOURS),
    )
    session.add(token)
    await session.commit()
    await session.refresh(token)
    return token, raw_token


async def list_invites(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[AccountToken], int]:
    base = select(AccountToken).where(AccountToken.purpose == "invite")
    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    result = await session.execute(
        base.order_by(AccountToken.created_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_invite(session: AsyncSession, invite_id: UUID) -> AccountToken:
    result = await session.execute(
        select(AccountToken).where(AccountToken.id == invite_id, AccountToken.purpose == "invite")
    )
    token = result.scalar_one_or_none()
    if token is None:
        raise NotFoundError("Invite not found", code="INVITE_NOT_FOUND")
    return token


async def revoke_invite(session: AsyncSession, invite_id: UUID) -> AccountToken:
    token = await get_invite(session, invite_id)
    if token.used_at is not None:
        raise ConflictError("Invite has already been accepted", code="INVITE_ALREADY_USED")
    if token.revoked_at is None:
        token.revoked_at = utcnow()
        await session.commit()
        await session.refresh(token)
    return token


async def accept_invite(session: AsyncSession, data: AcceptInviteRequest) -> User:
    raw_token = data.token
    result = await session.execute(
        select(AccountToken).where(
            AccountToken.token_hash == hash_token(raw_token),
            AccountToken.purpose == "invite",
        )
    )
    token = result.scalar_one_or_none()
    if token is None:
        raise NotFoundError("Invite not found", code="INVITE_NOT_FOUND")
    if token.revoked_at is not None:
        raise ConflictError("Invite has been revoked", code="INVITE_REVOKED")
    if token.used_at is not None:
        raise ConflictError("Invite has already been accepted", code="INVITE_ALREADY_USED")
    if token.expires_at <= utcnow():
        raise ConflictError("Invite has expired", code="INVITE_EXPIRED")
    if await _user_exists(session, token.email or ""):
        raise ConflictError("A user with this email already exists", code="EMAIL_IN_USE")

    user = User(
        email=token.email or "",
        password_hash=hash_password(data.password),
        role=token.role or "user",
    )
    session.add(user)
    token.used_at = utcnow()
    await session.commit()
    await session.refresh(user)
    return user
