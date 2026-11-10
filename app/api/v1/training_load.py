from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.training_load import TrainingLoadQuery, TrainingLoadResponse
from app.services.training_load import weekly_training_load

router = APIRouter(prefix="/training-load", tags=["training load"])


@router.get(
    "",
    operation_id="get_training_load",
    summary="Review logged sets and external-load volume by week",
    description=(
        "Returns Monday-start weeks in the requested timezone, oldest first. Counts workout "
        "records with exercise sets and uses their logged weights and volume rules. Separate "
        "activity records are excluded. Weeks without recorded work have zero counts."
    ),
    response_model=TrainingLoadResponse,
)
async def get_training_load(
    query: Annotated[TrainingLoadQuery, Query()],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TrainingLoadResponse:
    return await weekly_training_load(session, query)
