from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.exercise_stats import ExerciseStatsQuery, ExerciseStatsResponse
from app.services import exercise_stats as exercise_stats_service

router = APIRouter(prefix="/exercise-stats", tags=["exercise stats"])


@router.get(
    "",
    operation_id="get_exercise_stats",
    summary="Get per-exercise progress statistics",
    description="Summarizes logged workout history for each requested exercise name "
    "(case-insensitive): last session, heaviest set, estimated one-rep max "
    "from recorded weight and reps in the same set, and the working-weight trend "
    "between the two most recent sessions. Both timestamps are required to filter to a range "
    "[date_from, date_to). Items are returned in the order the names were requested.",
    response_model=ExerciseStatsResponse,
)
async def get_exercise_stats(
    query: Annotated[ExerciseStatsQuery, Query()],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ExerciseStatsResponse:
    items = await exercise_stats_service.get_exercise_stats(
        session, query.name, query.formula, date_from=query.date_from, date_to=query.date_to
    )
    return ExerciseStatsResponse(items=items)
