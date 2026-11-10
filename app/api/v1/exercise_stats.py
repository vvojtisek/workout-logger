from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.exercise_stats import ExerciseStatsResponse, OneRepMaxFormula
from app.services import exercise_stats as exercise_stats_service

router = APIRouter(prefix="/exercise-stats", tags=["exercise stats"])


@router.get(
    "",
    operation_id="get_exercise_stats",
    summary="Get per-exercise progress statistics",
    description="Summarizes logged workout history for each requested exercise name "
    "(case-insensitive): last session, heaviest set, estimated one-rep max "
    "from recorded weight and reps in the same set, and the working-weight trend "
    "between the two most recent sessions. Items are returned "
    "in the order the names were requested.",
    response_model=ExerciseStatsResponse,
)
async def get_exercise_stats(
    name: Annotated[
        list[Annotated[str, Query(min_length=1, max_length=150)]],
        Query(min_length=1, max_length=50),
    ],
    session: Annotated[AsyncSession, Depends(get_session)],
    formula: Annotated[
        OneRepMaxFormula,
        Query(description="Epley uses all logged rep counts. Other formulas use 1–10 reps."),
    ] = "epley",
) -> ExerciseStatsResponse:
    items = await exercise_stats_service.get_exercise_stats(session, name, formula)
    return ExerciseStatsResponse(items=items)
