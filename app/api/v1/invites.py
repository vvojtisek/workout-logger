from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, Security, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.invites import InviteCreate, InviteCreated, InviteRead, PaginatedInvitesResponse
from app.security import require_admin
from app.services import invites as invites_service

# Gated on the existing token-scope `admin` for now (the only admin identity
# that exists before sessions/account-admin land in slice 3). Slice 3 decides
# whether a session-authenticated account-admin should also reach this router.
router = APIRouter(prefix="/invites", tags=["invites"], dependencies=[Security(require_admin)])


@router.get(
    "",
    operation_id="list_invites",
    summary="List invites",
    description="Returns a paginated list of invites, most recently created first. Admin scope required.",
    response_model=PaginatedInvitesResponse,
)
async def list_invites(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedInvitesResponse:
    items, total = await invites_service.list_invites(session, limit, offset)
    return PaginatedInvitesResponse(
        items=[invites_service.invite_to_read(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_invite",
    summary="Create an invite",
    description=(
        "Issues a single-use invite for an email address. The raw token is returned only in "
        "this response -- there is no email delivery, so it must be copied/sent manually. "
        "Admin scope required."
    ),
    response_model=InviteCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_invite(
    data: InviteCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> InviteCreated:
    # No admin identity to attribute this to yet -- token-scope admin auth
    # (bootstrap API_KEY or an admin-scoped ApiToken) isn't tied to a User
    # row until slice 7. `issued_by` stays null until then.
    token, raw_token = await invites_service.create_invite(session, data, issued_by=None)
    response.headers["Location"] = f"/api/v1/invites/{token.id}"
    return InviteCreated(**invites_service.invite_to_read(token).model_dump(), token=raw_token)


@router.get(
    "/{invite_id}",
    operation_id="get_invite",
    summary="Get an invite",
    response_model=InviteRead,
    responses={404: {"model": ErrorResponse, "description": "Invite not found"}},
)
async def get_invite(invite_id: UUID, session: AsyncSession = Depends(get_session)) -> InviteRead:
    token = await invites_service.get_invite(session, invite_id)
    return invites_service.invite_to_read(token)


@router.post(
    "/{invite_id}/revoke",
    operation_id="revoke_invite",
    summary="Revoke an invite",
    description="Immediately blocks the invite from being accepted. Revocation cannot be undone.",
    response_model=InviteRead,
    responses={404: {"model": ErrorResponse, "description": "Invite not found"}},
)
async def revoke_invite(
    invite_id: UUID, session: AsyncSession = Depends(get_session)
) -> InviteRead:
    token = await invites_service.revoke_invite(session, invite_id)
    return invites_service.invite_to_read(token)
