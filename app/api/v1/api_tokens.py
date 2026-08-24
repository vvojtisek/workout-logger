from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, Security, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.api_tokens import (
    ApiTokenCreate,
    ApiTokenCreated,
    ApiTokenRead,
    PaginatedApiTokensResponse,
)
from app.schemas.common import ErrorResponse
from app.security import require_admin
from app.services import api_tokens as api_tokens_service

router = APIRouter(prefix="/tokens", tags=["tokens"], dependencies=[Security(require_admin)])


@router.get(
    "",
    operation_id="list_api_tokens",
    summary="List API tokens",
    description="Returns a paginated list of API tokens, most recently created first. Admin scope required.",
    response_model=PaginatedApiTokensResponse,
)
async def list_api_tokens(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedApiTokensResponse:
    items, total = await api_tokens_service.list_api_tokens(session, limit, offset)
    return PaginatedApiTokensResponse(
        items=[ApiTokenRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_api_token",
    summary="Create an API token",
    description=(
        "Mints a new scoped API token. The raw secret is returned only in this response "
        "and cannot be recovered afterward. Admin scope required."
    ),
    response_model=ApiTokenCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_token(
    data: ApiTokenCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> ApiTokenCreated:
    token, raw_token = await api_tokens_service.create_api_token(session, data)
    response.headers["Location"] = f"/api/v1/tokens/{token.id}"
    return ApiTokenCreated(**ApiTokenRead.model_validate(token).model_dump(), token=raw_token)


@router.get(
    "/{token_id}",
    operation_id="get_api_token",
    summary="Get an API token",
    response_model=ApiTokenRead,
    responses={404: {"model": ErrorResponse, "description": "API token not found"}},
)
async def get_api_token(
    token_id: UUID, session: AsyncSession = Depends(get_session)
) -> ApiTokenRead:
    token = await api_tokens_service.get_api_token(session, token_id)
    return ApiTokenRead.model_validate(token)


@router.post(
    "/{token_id}/revoke",
    operation_id="revoke_api_token",
    summary="Revoke an API token",
    description="Immediately blocks the token from authenticating. Revocation cannot be undone.",
    response_model=ApiTokenRead,
    responses={404: {"model": ErrorResponse, "description": "API token not found"}},
)
async def revoke_api_token(
    token_id: UUID, session: AsyncSession = Depends(get_session)
) -> ApiTokenRead:
    token = await api_tokens_service.revoke_api_token(session, token_id)
    return ApiTokenRead.model_validate(token)
