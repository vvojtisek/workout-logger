from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.settings import UserSettingsRead, UserSettingsUpdate
from app.services import settings as settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get(
    "",
    operation_id="get_settings",
    summary="Get user settings",
    description="Returns display and defaults preferences, creating the one settings "
    "row with defaults on first read.",
    response_model=UserSettingsRead,
)
async def get_settings(session: AsyncSession = Depends(get_session)) -> UserSettingsRead:
    settings = await settings_service.get_settings(session)
    return UserSettingsRead.model_validate(settings)


@router.put(
    "",
    operation_id="update_settings",
    summary="Replace user settings",
    response_model=UserSettingsRead,
)
async def update_settings(
    data: UserSettingsUpdate, session: AsyncSession = Depends(get_session)
) -> UserSettingsRead:
    settings = await settings_service.update_settings(session, data)
    return UserSettingsRead.model_validate(settings)
