from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.exercise_stats import ExerciseStatsResponse
from app.services import exercise_stats as exercise_stats_service

router = APIRouter(prefix="/exercise-stats", tags=["exercise stats"])


@router.get(
    "",
    operation_id="get_exercise_stats",
    summary="Get per-exercise progress statistics",
    description="Summarizes logged workout history for each requested exercise name "
    "(case-insensitive): last session, heaviest set, Epley estimated one-rep max, "
    "and the load trend between the two most recent sessions. Items are returned "
    "in the order the names were requested.",
    response_model=ExerciseStatsResponse,
)
async def get_exercise_stats(
    name: Annotated[
        list[Annotated[str, Query(min_length=1, max_length=150)]],
        Query(min_length=1, max_length=50),
    ],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ExerciseStatsResponse:
    items = await exercise_stats_service.get_exercise_stats(session, name)
    return ExerciseStatsResponse(items=items)
