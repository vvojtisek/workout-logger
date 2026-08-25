from uuid import UUID

from fastapi import APIRouter, Depends, Query, Security
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.users import PaginatedUsersResponse, ResetPasswordIssued, UserRead
from app.security import require_admin
from app.services import users as users_service

# `require_admin` accepts either a token-scope admin (bootstrap API_KEY or an
# admin-scoped ApiToken) or a session-authenticated account admin.
router = APIRouter(prefix="/users", tags=["users"], dependencies=[Security(require_admin)])


@router.get(
    "",
    operation_id="list_users",
    summary="List users",
    description="Returns a paginated list of accounts, most recently created first. Admin scope required.",
    response_model=PaginatedUsersResponse,
)
async def list_users(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedUsersResponse:
    items, total = await users_service.list_users(session, limit, offset)
    return PaginatedUsersResponse(
        items=[UserRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{user_id}",
    operation_id="get_user",
    summary="Get a user",
    response_model=UserRead,
    responses={404: {"model": ErrorResponse, "description": "User not found"}},
)
async def get_user(user_id: UUID, session: AsyncSession = Depends(get_session)) -> UserRead:
    user = await users_service.get_user(session, user_id)
    return UserRead.model_validate(user)


@router.post(
    "/{user_id}/revoke",
    operation_id="revoke_user",
    summary="Disable a user",
    description="Blocks the account from logging in. Does not affect existing sessions/tokens yet.",
    response_model=UserRead,
    responses={404: {"model": ErrorResponse, "description": "User not found"}},
)
async def revoke_user(user_id: UUID, session: AsyncSession = Depends(get_session)) -> UserRead:
    user = await users_service.revoke_user(session, user_id)
    return UserRead.model_validate(user)


@router.post(
    "/{user_id}/reset-password",
    operation_id="reset_user_password",
    summary="Issue a password reset",
    description=(
        "Issues a single-use password reset token. The raw token is returned only in this "
        "response -- there is no email delivery, so it must be copied/sent manually."
    ),
    response_model=ResetPasswordIssued,
    responses={404: {"model": ErrorResponse, "description": "User not found"}},
)
async def reset_user_password(
    user_id: UUID, session: AsyncSession = Depends(get_session)
) -> ResetPasswordIssued:
    token, raw_token = await users_service.issue_password_reset(session, user_id, issued_by=None)
    return ResetPasswordIssued(token=raw_token, expires_at=token.expires_at)
