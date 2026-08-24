from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.invites import AcceptInviteRequest
from app.schemas.users import UserRead
from app.services import invites as invites_service

# Registered directly on the app in app/main.py, NOT through `api_router` --
# these routes must be reachable without any prior authentication (there is
# no session or API key yet at invite-acceptance time). Login/logout/me join
# this router in slice 2.
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/invites/accept",
    operation_id="accept_invite",
    summary="Accept an invite",
    description="Creates the account for a valid, unused, unexpired invite token and sets its password.",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Invite not found"},
        409: {"model": ErrorResponse, "description": "Invite already used, revoked, or expired"},
    },
)
async def accept_invite(
    data: AcceptInviteRequest, session: AsyncSession = Depends(get_session)
) -> UserRead:
    user = await invites_service.accept_invite(session, data)
    return UserRead.model_validate(user)
