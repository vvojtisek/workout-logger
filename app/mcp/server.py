"""The MCP server, mounted into the same FastAPI app at `/mcp`.

Per the modular-monolith decision (docs/health-tracker-implementation-instructions.md
§3.1) this is one deployable, not a second service. Tools therefore call
`app/services/*` directly rather than looping back through HTTP, so they share
the REST layer's validation, conflict handling, and transaction boundaries.
"""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from fastmcp import FastMCP
from fastmcp.server.auth import require_scopes

from app.config import get_settings
from app.database import get_session_maker
from app.mcp.oauth import build_mcp_oauth_provider
from app.schemas.body_metrics import BodyMetricCreate, BodyMetricRead
from app.schemas.meal_entries import MealEntryCreate, MealEntryRead, MealItemCreate
from app.schemas.plans import PlanExerciseCreate, WorkoutPlanCreate, WorkoutPlanRead
from app.schemas.programs import ProgramRead
from app.schemas.scheduled_workouts import ScheduledWorkoutCreate, ScheduledWorkoutRead
from app.schemas.workout_sessions import SetEntryCreate, WorkoutSessionRead
from app.services import body_metrics as body_metrics_service
from app.services import meal_entries as meal_entries_service
from app.services import nutrition_dashboard as nutrition_dashboard_service
from app.services import plans as plans_service
from app.services import programs as programs_service
from app.services import scheduled_workouts as scheduled_workouts_service
from app.services import workout_sessions as workout_sessions_service

mcp: FastMCP = FastMCP(
    name="workout-logger",
    instructions=(
        "Read and log training, nutrition, and body-composition data for a single "
        "athlete's workout logger. Query tools need a token with the 'read' scope; "
        "logging tools need 'log'."
    ),
    auth=build_mcp_oauth_provider(get_settings()),
)


@mcp.tool(
    name="list_programs",
    description="List training programs (blocks), most recently started first.",
    auth=require_scopes("read"),
)
async def list_programs(limit: int = 50, offset: int = 0) -> dict[str, Any]:
    async with get_session_maker()() as session:
        items, total = await programs_service.list_programs(session, limit, offset)
        return {
            "items": [ProgramRead.model_validate(item).model_dump(mode="json") for item in items],
            "total": total,
            "limit": limit,
            "offset": offset,
        }


@mcp.tool(
    name="get_plan",
    description="Fetch one workout plan by id, including its ordered exercises.",
    auth=require_scopes("read"),
)
async def get_plan(plan_id: UUID) -> dict[str, Any]:
    async with get_session_maker()() as session:
        plan = await plans_service.get_plan(session, plan_id)
        return WorkoutPlanRead.model_validate(plan).model_dump(mode="json")


@mcp.tool(
    name="create_plan",
    description=(
        "Create a workout plan. Each exercise needs exercise_name, target_sets, "
        "target_reps_min and target_reps_max; set group_key/group_order to link "
        "exercises into a superset. Exercise order follows the list order."
    ),
    auth=require_scopes("log"),
)
async def create_plan(
    name: str,
    exercises: list[PlanExerciseCreate],
    description: str | None = None,
) -> dict[str, Any]:
    data = WorkoutPlanCreate(name=name, description=description, exercises=exercises)
    async with get_session_maker()() as session:
        plan = await plans_service.create_plan(session, data)
        return WorkoutPlanRead.model_validate(plan).model_dump(mode="json")


@mcp.tool(
    name="schedule_workout",
    description=(
        "Put a workout plan on the calendar for a date, optionally as part of a "
        "program. Overlapping programs may schedule work on the same day."
    ),
    auth=require_scopes("log"),
)
async def schedule_workout(
    workout_plan_id: UUID,
    scheduled_date: date,
    program_id: UUID | None = None,
) -> dict[str, Any]:
    data = ScheduledWorkoutCreate(
        workout_plan_id=workout_plan_id, scheduled_date=scheduled_date, program_id=program_id
    )
    async with get_session_maker()() as session:
        scheduled = await scheduled_workouts_service.schedule_workout(session, data)
        return ScheduledWorkoutRead.model_validate(scheduled).model_dump(mode="json")


@mcp.tool(
    name="log_set",
    description=(
        "Record one set in an active workout session. client_operation_id makes "
        "the write idempotent: replaying the same id returns the session unchanged "
        "rather than duplicating the set. Returns the updated session."
    ),
    auth=require_scopes("log"),
)
async def log_set(
    session_id: UUID,
    session_exercise_id: UUID,
    set_number: int,
    reps: int,
    client_operation_id: str,
    weight_kg: float | None = None,
    rir: int | None = None,
    rpe: int | None = None,
    added_weight_kg: float | None = None,
    band_level: str | None = None,
    duration_seconds: int | None = None,
    distance_km: float | None = None,
    incline_percent: float | None = None,
) -> dict[str, Any]:
    data = SetEntryCreate(
        session_exercise_id=session_exercise_id,
        set_number=set_number,
        reps=reps,
        client_operation_id=client_operation_id,
        weight_kg=weight_kg,
        rir=rir,
        rpe=rpe,
        added_weight_kg=added_weight_kg,
        band_level=band_level,
        duration_seconds=duration_seconds,
        distance_km=distance_km,
        incline_percent=incline_percent,
    )
    async with get_session_maker()() as db:
        workout_session, created = await workout_sessions_service.save_set(db, session_id, data)
        return {
            "created": created,
            "session": WorkoutSessionRead.model_validate(workout_session).model_dump(mode="json"),
        }


@mcp.tool(
    name="log_meal",
    description=(
        "Log a meal with one or more items. An item either references a catalogue "
        "food by food_id (nutrition is snapshotted and scaled by quantity) or "
        "supplies its own name, unit, and macros for an ad hoc entry."
    ),
    auth=require_scopes("log"),
)
async def log_meal(
    consumed_at: datetime,
    meal_type: str,
    items: list[MealItemCreate],
    notes: str | None = None,
) -> dict[str, Any]:
    data = MealEntryCreate(
        consumed_at=consumed_at,
        meal_type=meal_type,  # type: ignore[arg-type]  # validated against the MealType literal
        items=items,
        notes=notes,
    )
    async with get_session_maker()() as session:
        entry = await meal_entries_service.create_meal_entry(session, data)
        return MealEntryRead.model_validate(entry).model_dump(mode="json")


@mcp.tool(
    name="log_biometrics",
    description=(
        "Record a body-composition measurement. weight_kg is required; the "
        "circumference fields and body_fat_percent are optional."
    ),
    auth=require_scopes("log"),
)
async def log_biometrics(
    measured_at: datetime,
    weight_kg: float,
    body_fat_percent: float | None = None,
    neck_cm: float | None = None,
    chest_cm: float | None = None,
    waist_cm: float | None = None,
    hips_cm: float | None = None,
    biceps_cm: float | None = None,
    forearms_cm: float | None = None,
    thighs_cm: float | None = None,
    calves_cm: float | None = None,
) -> dict[str, Any]:
    data = BodyMetricCreate(
        measured_at=measured_at,
        weight_kg=weight_kg,
        body_fat_percent=body_fat_percent,
        neck_cm=neck_cm,
        chest_cm=chest_cm,
        waist_cm=waist_cm,
        hips_cm=hips_cm,
        biceps_cm=biceps_cm,
        forearms_cm=forearms_cm,
        thighs_cm=thighs_cm,
        calves_cm=calves_cm,
    )
    async with get_session_maker()() as session:
        metric = await body_metrics_service.create_body_metric(session, data)
        return BodyMetricRead.model_validate(metric).model_dump(mode="json")


@mcp.tool(
    name="get_daily_summary",
    description=(
        "Nutrition totals for one date, plus the applicable plan's targets and "
        "what remains against them. Aggregated server-side for that day only."
    ),
    auth=require_scopes("read"),
)
async def get_daily_summary(on_date: date) -> dict[str, Any]:
    async with get_session_maker()() as session:
        summary = await nutrition_dashboard_service.get_daily_summary(session, on_date)
        return summary.model_dump(mode="json")
