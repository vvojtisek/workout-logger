from fastapi import APIRouter, Depends, Security
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.coaching_principles import CoachingPrinciplesRead, CoachingPrinciplesUpdate
from app.security import require_admin
from app.services import coaching_principles as principles_service

router = APIRouter(prefix="/coaching-principles", tags=["coaching-principles"])


@router.get(
    "",
    operation_id="get_coaching_principles",
    summary="Get the coaching principles",
    description="The admin's coaching beliefs as one text, empty until first saved. "
    "Input for block design over MCP; the app's own rules do not read it.",
    response_model=CoachingPrinciplesRead,
)
async def get_principles(session: AsyncSession = Depends(get_session)) -> CoachingPrinciplesRead:
    return await principles_service.get_principles(session)


@router.put(
    "",
    operation_id="replace_coaching_principles",
    summary="Replace the coaching principles",
    description="Admin only.",
    response_model=CoachingPrinciplesRead,
    dependencies=[Security(require_admin)],
)
async def replace_principles(
    data: CoachingPrinciplesUpdate, session: AsyncSession = Depends(get_session)
) -> CoachingPrinciplesRead:
    return await principles_service.replace_principles(session, data)
