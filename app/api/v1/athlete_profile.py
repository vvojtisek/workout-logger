from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.athlete_profile import AthleteProfileRead, AthleteProfileReplace
from app.services import athlete_profile as profile_service

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get(
    "",
    operation_id="get_athlete_profile",
    summary="Get the athlete profile",
    description="Goals, hard dietary exclusions and physical constraints. Empty until saved.",
    response_model=AthleteProfileRead,
)
async def get_profile(session: Annotated[AsyncSession, Depends(get_session)]) -> AthleteProfileRead:
    return await profile_service.get_profile(session)


@router.put(
    "",
    operation_id="replace_athlete_profile",
    summary="Replace the athlete profile",
    description="Not exposed to assistants: only the athlete edits hard exclusions.",
    response_model=AthleteProfileRead,
)
async def replace_profile(
    data: AthleteProfileReplace, session: Annotated[AsyncSession, Depends(get_session)]
) -> AthleteProfileRead:
    return await profile_service.replace_profile(session, data)
