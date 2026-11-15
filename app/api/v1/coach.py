"""The assistant-facing coaching loop: one read and three writes. The MCP
tools of the same names call the same services (app/mcp/server.py)."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.coach import (
    AdaptiveWorkoutResult,
    AdaptiveWorkoutUpsert,
    CoachingContext,
    CoachLogRequest,
    CoachLogResult,
    ExerciseBaseline,
)
from app.schemas.common import ErrorResponse
from app.schemas.meal_plans import (
    DayPlanRead,
    NutritionPlanUpsert,
    NutritionPlanUpsertResult,
    SupplementRead,
)
from app.security import AuthContext
from app.services import coach_context, coach_log, coach_workouts, exercise_baseline, meal_plans
from app.services import supplements as supplements_service

router = APIRouter(prefix="/coach", tags=["coach"])


def write_source(request: Request) -> str:
    """'app' for the logged-in phone, 'api' for a token (scripts, GPT Actions)."""
    auth: AuthContext = request.state.auth_context
    return "app" if auth.user is not None else "api"


@router.get(
    "/context",
    operation_id="get_coaching_context",
    summary="Get the coaching context",
    description=(
        "Read this first. Profile with hard dietary exclusions, equipment, the last N days of "
        "training, readiness and sleep, upcoming sessions, meal plans, macro adherence and "
        "supplements, in one compact payload."
    ),
    response_model=CoachingContext,
)
async def get_coaching_context(
    session: Annotated[AsyncSession, Depends(get_session)],
    days: Annotated[int, Query(ge=1, le=28, description="Days of history, ending today.")] = 7,
    today: Annotated[
        date | None, Query(description="The athlete's local date. Omitted: today in UTC.")
    ] = None,
) -> CoachingContext:
    return await coach_context.build_context(session, days=days, today=today)


@router.post(
    "/log",
    operation_id="log_readiness_and_activity",
    summary="Log a check-in and/or an activity",
    description=(
        "Record soreness, fatigue and sleep quality, and/or a finished activity (ice hockey, "
        "swim, swim + sauna, sauna, gym, ride, hike, run). Omitted fields use sensible "
        "defaults. Both records save together."
    ),
    response_model=CoachLogResult,
    status_code=201,
)
async def log_readiness_and_activity(
    data: CoachLogRequest, request: Request, session: Annotated[AsyncSession, Depends(get_session)]
) -> CoachLogResult:
    return await coach_log.log_readiness_and_activity(session, data, source=write_source(request))


@router.put(
    "/nutrition-plan",
    operation_id="upsert_daily_nutrition_plan",
    summary="Write the meal plan for one or more days",
    description=(
        "Create or replace 1-7 days of meals (ingredients with quantities, macros, prep steps) "
        "and macro targets, rebuild each day's shopping list, and optionally replace the "
        "supplement stack, in one transaction. Rejects hard dietary exclusions."
    ),
    response_model=NutritionPlanUpsertResult,
    responses={422: {"model": ErrorResponse, "description": "Breaks a dietary constraint"}},
)
async def upsert_daily_nutrition_plan(
    data: NutritionPlanUpsert, session: Annotated[AsyncSession, Depends(get_session)]
) -> NutritionPlanUpsertResult:
    days = await meal_plans.upsert_plan(session, data, source="coach")
    return NutritionPlanUpsertResult(
        days=[DayPlanRead.model_validate(day) for day in days],
        supplements=[
            SupplementRead.model_validate(item)
            for item in await supplements_service.list_active(session)
        ],
    )


@router.put(
    "/workout-plan",
    operation_id="upsert_adaptive_workout_plan",
    summary="Prescribe a gym or recovery session for a date",
    description=(
        "Create or replace the coach session for a date and name: exercises with target sets, "
        "reps, kg, RIR/RPE, rest and a short rationale. The phone pre-fills these targets. "
        "Returns history-based baselines for comparison."
    ),
    response_model=AdaptiveWorkoutResult,
    responses={409: {"model": ErrorResponse, "description": "Session already started"}},
)
async def upsert_adaptive_workout_plan(
    data: AdaptiveWorkoutUpsert, session: Annotated[AsyncSession, Depends(get_session)]
) -> AdaptiveWorkoutResult:
    return await coach_workouts.upsert_adaptive_workout_plan(session, data)


@router.get(
    "/exercise-baseline",
    operation_id="get_exercise_baseline",
    summary="Get an exercise's recent sessions and today's suggestion",
    description=(
        "The last 3-5 sessions of an exercise with e1RM, the double-progression suggestion, "
        "and that suggestion scaled by today's readiness check-in."
    ),
    response_model=ExerciseBaseline,
)
async def get_exercise_baseline(
    session: Annotated[AsyncSession, Depends(get_session)],
    exercise_name: Annotated[str, Query(min_length=1, max_length=150)],
    plan_id: Annotated[UUID | None, Query()] = None,
    rep_min: Annotated[int | None, Query(ge=1, le=100)] = None,
    rep_max: Annotated[int | None, Query(ge=1, le=100)] = None,
) -> ExerciseBaseline:
    return await exercise_baseline.exercise_baseline(
        session, exercise_name.strip(), plan_id=plan_id, rep_min=rep_min, rep_max=rep_max
    )
