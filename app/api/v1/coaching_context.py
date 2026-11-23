from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.coaching_context import (
    CoachingContextNotesUpdate,
    CoachingContextProfileUpdate,
    CoachingContextRead,
    CoachingContextRevertRequest,
)
from app.schemas.common import ErrorResponse
from app.services import coaching_context as coaching_context_service

router = APIRouter(prefix="/coaching-context", tags=["coaching context"])
SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "",
    operation_id="get_coaching_context_notes",
    summary="Get two-tier portable coaching context",
    response_model=CoachingContextRead,
)
async def get_coaching_context(session: SessionDep) -> CoachingContextRead:
    record = await coaching_context_service.get_coaching_context(session)
    return CoachingContextRead.model_validate(record)


@router.put(
    "/profile",
    operation_id="update_coaching_profile",
    summary="Update Tier 1 athlete profile (PWA/REST only)",
    response_model=CoachingContextRead,
    responses={409: {"model": ErrorResponse, "description": "Stale profile version conflict"}},
)
async def update_coaching_profile(
    data: CoachingContextProfileUpdate, session: SessionDep
) -> CoachingContextRead:
    record = await coaching_context_service.update_profile(session, data)
    return CoachingContextRead.model_validate(record)


@router.put(
    "/notes",
    operation_id="update_coaching_notes",
    summary="Update Tier 2 coaching working notes",
    response_model=CoachingContextRead,
    responses={409: {"model": ErrorResponse, "description": "Stale notes version conflict"}},
)
async def update_coaching_notes(
    data: CoachingContextNotesUpdate, session: SessionDep
) -> CoachingContextRead:
    record = await coaching_context_service.update_notes(session, data)
    return CoachingContextRead.model_validate(record)


@router.post(
    "/revert",
    operation_id="revert_coaching_context",
    summary="Revert Tier 1 profile or Tier 2 working notes to the previous snapshot",
    response_model=CoachingContextRead,
    responses={
        409: {"model": ErrorResponse, "description": "No previous snapshot available to revert"}
    },
)
async def revert_coaching_context(
    data: CoachingContextRevertRequest, session: SessionDep
) -> CoachingContextRead:
    record = await coaching_context_service.revert_context(session, data.target)
    return CoachingContextRead.model_validate(record)
