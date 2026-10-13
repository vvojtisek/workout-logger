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
from app.security_passwords import hash_password
from app.token_hash import hash_token

_TOKEN_PREFIX = "inv_"
_PREFIX_DISPLAY_LEN = 10
MAX_INVITED_USERS = 10


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


async def _has_pending_invite(
    session: AsyncSession, email: str, *, exclude_invite_id: UUID | None = None
) -> bool:
    query = select(AccountToken).where(
        AccountToken.purpose == "invite",
        AccountToken.email == email,
        AccountToken.used_at.is_(None),
        AccountToken.revoked_at.is_(None),
        AccountToken.expires_at > utcnow(),
    )
    if exclude_invite_id is not None:
        query = query.where(AccountToken.id != exclude_invite_id)
    result = await session.execute(query)
    return result.scalar_one_or_none() is not None


async def _user_exists(session: AsyncSession, email: str) -> bool:
    result = await session.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none() is not None


async def _occupied_user_slots(
    session: AsyncSession, *, exclude_invite_id: UUID | None = None
) -> int:
    user_count = await session.scalar(
        select(func.count()).select_from(User).where(User.role == "user")
    )
    pending_invites = select(AccountToken).where(
        AccountToken.purpose == "invite",
        AccountToken.role == "user",
        AccountToken.used_at.is_(None),
        AccountToken.revoked_at.is_(None),
        AccountToken.expires_at > utcnow(),
    )
    if exclude_invite_id is not None:
        pending_invites = pending_invites.where(AccountToken.id != exclude_invite_id)
    pending_count = await session.scalar(
        select(func.count()).select_from(pending_invites.subquery())
    )
    return (user_count or 0) + (pending_count or 0)


async def create_invite(
    session: AsyncSession, data: InviteCreate, issued_by: UUID | None
) -> tuple[AccountToken, str]:
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
    # The insert takes SQLite's single-writer lock before capacity is checked.
    # Concurrent invite requests then observe the preceding committed invite
    # instead of all claiming the same final slot.
    await session.flush()

    if await _user_exists(session, data.email):
        await session.rollback()
        raise ConflictError("A user with this email already exists", code="EMAIL_IN_USE")
    if await _has_pending_invite(session, data.email, exclude_invite_id=token.id):
        await session.rollback()
        raise ConflictError("A pending invite already exists for this email", code="INVITE_PENDING")
    if await _occupied_user_slots(session) > MAX_INVITED_USERS:
        await session.rollback()
        raise ConflictError(
            f"This deployment is full (maximum {MAX_INVITED_USERS} invited users)",
            code="USER_CAPACITY_REACHED",
        )

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
    if token.role != "user":
        raise ConflictError(
            "Only standard user invites can be accepted", code="INVALID_INVITE_ROLE"
        )
    if await _user_exists(session, token.email or ""):
        raise ConflictError("A user with this email already exists", code="EMAIL_IN_USE")
    if await _occupied_user_slots(session, exclude_invite_id=token.id) >= MAX_INVITED_USERS:
        raise ConflictError(
            f"This deployment is full (maximum {MAX_INVITED_USERS} invited users)",
            code="USER_CAPACITY_REACHED",
        )

    user = User(
        email=token.email or "",
        password_hash=hash_password(data.password),
        role="user",
    )
    session.add(user)
    token.used_at = utcnow()
    await session.commit()
    await session.refresh(user)
    return user
