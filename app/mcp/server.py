"""The MCP server, mounted into the same FastAPI app at `/mcp`.

Per the modular-monolith decision (docs/health-tracker-implementation-instructions.md
§3.1) this is one deployable, not a second service. Tools therefore call
`app/services/*` directly rather than looping back through HTTP, so they share
the REST layer's validation, conflict handling, and transaction boundaries.
"""

from datetime import date, datetime
from typing import Any, TypeVar
from uuid import UUID

from fastmcp import FastMCP
from fastmcp.server.auth import require_scopes
from pydantic import BaseModel

from app.config import get_settings
from app.database import get_session_maker
from app.exceptions import NotFoundError
from app.mcp.audit import AuditMiddleware
from app.mcp.oauth import build_mcp_oauth_provider
from app.schemas.body_metrics import BodyMetricCreate, BodyMetricRead, BodyMetricReplace
from app.schemas.foods import FoodCreate, FoodRead, FoodReplace
from app.schemas.logs import (
    ActivityType,
    ExerciseLogCreate,
    WorkoutLogCreate,
    WorkoutLogRead,
    WorkoutLogReplace,
)
from app.schemas.meal_entries import (
    MealEntryCreate,
    MealEntryDetails,
    MealEntryRead,
    MealEntryReplace,
    MealItemCreate,
)
from app.schemas.plans import PlanExerciseCreate, WorkoutPlanCreate, WorkoutPlanRead
from app.schemas.programs import ProgramRead
from app.schemas.scheduled_workouts import ScheduledWorkoutCreate, ScheduledWorkoutRead
from app.schemas.sleep_entries import SleepEntryCreate, SleepEntryRead, SleepEntryReplace
from app.schemas.workout_sessions import (
    SetEntryCreate,
    SetEntryRead,
    SetEntryUpdate,
    WorkoutSessionComplete,
    WorkoutSessionRead,
)
from app.services import body_metrics as body_metrics_service
from app.services import coaching_principles as principles_service
from app.services import foods as foods_service
from app.services import logs as logs_service
from app.services import meal_entries as meal_entries_service
from app.services import nutrition_dashboard as nutrition_dashboard_service
from app.services import plans as plans_service
from app.services import programs as programs_service
from app.services import progression as progression_service
from app.services import scheduled_workouts as scheduled_workouts_service
from app.services import sleep_entries as sleep_entries_service
from app.services import workout_sessions as workout_sessions_service

mcp: FastMCP = FastMCP(
    name="workout-logger",
    instructions=(
        "Read and log training, nutrition, and body-composition data for a single "
        "athlete's workout logger. Query tools need a token with the 'read' scope; "
        "logging tools need 'log'."
    ),
    auth=build_mcp_oauth_provider(get_settings()),
    middleware=[AuditMiddleware()],
)

_EDIT_NOTE = " Only the fields you pass change; the others keep their current value."


M = TypeVar("M", bound=BaseModel)


def _merged(model: type[M], current: BaseModel, changes: dict[str, Any]) -> M:
    """Overlays the fields an agent passed onto the stored record and checks
    the result with the same schema the app's own edit form uses."""
    data = current.model_dump()
    data.update({key: value for key, value in changes.items() if value is not None})
    return model.model_validate(data)


def _page(
    read: type[BaseModel], items: list[Any], total: int, limit: int, offset: int
) -> dict[str, Any]:
    return {
        "items": [read.model_validate(item).model_dump(mode="json") for item in items],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def _deleted(record_id: UUID) -> dict[str, Any]:
    return {"deleted": True, "id": str(record_id)}


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
    name="get_coaching_principles",
    description=(
        "Read the admin's coaching principles: the training beliefs and "
        "preferences to follow when designing or reviewing a training block. "
        "Empty until the admin writes them in Settings."
    ),
    auth=require_scopes("read"),
)
async def get_coaching_principles() -> dict[str, Any]:
    async with get_session_maker()() as session:
        principles = await principles_service.get_principles(session)
        return principles.model_dump(mode="json")


@mcp.tool(
    name="get_progression_rules",
    description=(
        "Read the fixed double-progression rules the app uses to suggest the "
        "next session's load and reps. Read-only: the rules live in code."
    ),
    auth=require_scopes("read"),
)
async def get_progression_rules() -> dict[str, Any]:
    return {
        "rules": progression_service.__doc__,
        "lower_body_barbell_increment_kg": progression_service.LOWER_BARBELL_INCREMENT_KG,
        "other_increment_kg": progression_service.OTHER_INCREMENT_KG,
        "deload_factor": progression_service.DELOAD_FACTOR,
        "min_rir_to_add_load": progression_service.MIN_RIR_TO_ADD_LOAD,
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


# --- Body measurements (weight) -------------------------------------------


@mcp.tool(
    name="list_biometrics",
    description="List body-composition measurements (weight and more), newest first.",
    auth=require_scopes("read"),
)
async def list_biometrics(limit: int = 50, offset: int = 0) -> dict[str, Any]:
    async with get_session_maker()() as session:
        items, total = await body_metrics_service.list_body_metrics(session, limit, offset)
        return _page(BodyMetricRead, items, total, limit, offset)


@mcp.tool(
    name="update_biometrics",
    description="Change a body-composition measurement by id." + _EDIT_NOTE,
    auth=require_scopes("log"),
)
async def update_biometrics(
    body_metric_id: UUID,
    measured_at: datetime | None = None,
    weight_kg: float | None = None,
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
    changes = {k: v for k, v in locals().items() if k != "body_metric_id"}
    async with get_session_maker()() as session:
        current = await body_metrics_service.get_body_metric(session, body_metric_id)
        data = _merged(BodyMetricReplace, BodyMetricRead.model_validate(current), changes)
        metric = await body_metrics_service.replace_body_metric(session, body_metric_id, data)
        return BodyMetricRead.model_validate(metric).model_dump(mode="json")


@mcp.tool(
    name="delete_biometrics",
    description="Delete a body-composition measurement by id.",
    auth=require_scopes("log"),
)
async def delete_biometrics(body_metric_id: UUID) -> dict[str, Any]:
    async with get_session_maker()() as session:
        await body_metrics_service.delete_body_metric(session, body_metric_id)
    return _deleted(body_metric_id)


# --- Sleep ------------------------------------------------------------------


@mcp.tool(
    name="log_sleep",
    description=(
        "Record a night's sleep. sleep_start and sleep_end are UTC timestamps; "
        "timezone is the sleeper's IANA zone (e.g. Europe/Prague) and decides "
        "which day the night counts for. quality_score is 1-5."
    ),
    auth=require_scopes("log"),
)
async def log_sleep(
    sleep_start: datetime,
    sleep_end: datetime,
    timezone: str,
    estimated_sleep_seconds: int | None = None,
    awake_seconds: int | None = None,
    quality_score: int | None = None,
    resting_heart_rate: int | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    data = SleepEntryCreate(
        sleep_start=sleep_start,
        sleep_end=sleep_end,
        timezone=timezone,
        estimated_sleep_seconds=estimated_sleep_seconds,
        awake_seconds=awake_seconds,
        quality_score=quality_score,
        resting_heart_rate=resting_heart_rate,
        notes=notes,
    )
    async with get_session_maker()() as session:
        entry = await sleep_entries_service.create_sleep_entry(session, data)
        return SleepEntryRead.model_validate(entry).model_dump(mode="json")


@mcp.tool(
    name="list_sleep",
    description="List sleep entries, most recent night first.",
    auth=require_scopes("read"),
)
async def list_sleep(limit: int = 50, offset: int = 0) -> dict[str, Any]:
    async with get_session_maker()() as session:
        items, total = await sleep_entries_service.list_sleep_entries(session, limit, offset)
        return _page(SleepEntryRead, items, total, limit, offset)


@mcp.tool(
    name="update_sleep",
    description="Change a sleep entry by id." + _EDIT_NOTE,
    auth=require_scopes("log"),
)
async def update_sleep(
    sleep_entry_id: UUID,
    sleep_start: datetime | None = None,
    sleep_end: datetime | None = None,
    timezone: str | None = None,
    estimated_sleep_seconds: int | None = None,
    awake_seconds: int | None = None,
    quality_score: int | None = None,
    resting_heart_rate: int | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    changes = {k: v for k, v in locals().items() if k != "sleep_entry_id"}
    async with get_session_maker()() as session:
        current = await sleep_entries_service.get_sleep_entry(session, sleep_entry_id)
        data = _merged(SleepEntryReplace, SleepEntryRead.model_validate(current), changes)
        entry = await sleep_entries_service.replace_sleep_entry(session, sleep_entry_id, data)
        return SleepEntryRead.model_validate(entry).model_dump(mode="json")


@mcp.tool(
    name="delete_sleep",
    description="Delete a sleep entry by id.",
    auth=require_scopes("log"),
)
async def delete_sleep(sleep_entry_id: UUID) -> dict[str, Any]:
    async with get_session_maker()() as session:
        await sleep_entries_service.delete_sleep_entry(session, sleep_entry_id)
    return _deleted(sleep_entry_id)


# --- Food catalogue ---------------------------------------------------------


@mcp.tool(
    name="list_foods",
    description=(
        "Search the food catalogue by name or brand (q), alphabetically. Use a "
        "food's id in log_meal items to snapshot its nutrition."
    ),
    auth=require_scopes("read"),
)
async def list_foods(q: str | None = None, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    async with get_session_maker()() as session:
        items, total = await foods_service.list_foods(session, limit, offset, q)
        return _page(FoodRead, items, total, limit, offset)


@mcp.tool(
    name="create_food",
    description=(
        "Add a food to the catalogue. Nutrition values are per serving_quantity "
        "of serving_unit (for example per 100 g)."
    ),
    auth=require_scopes("log"),
)
async def create_food(
    name: str,
    serving_quantity: float,
    serving_unit: str,
    energy_kcal: float,
    protein_g: float,
    carbohydrate_g: float,
    fat_g: float,
    brand: str | None = None,
    fiber_g: float | None = None,
    category: str | None = None,
) -> dict[str, Any]:
    data = FoodCreate(
        name=name,
        brand=brand,
        serving_quantity=serving_quantity,
        serving_unit=serving_unit,
        energy_kcal=energy_kcal,
        protein_g=protein_g,
        carbohydrate_g=carbohydrate_g,
        fat_g=fat_g,
        fiber_g=fiber_g,
        category=category,
    )
    async with get_session_maker()() as session:
        food = await foods_service.create_food(session, data)
        return FoodRead.model_validate(food).model_dump(mode="json")


@mcp.tool(
    name="update_food",
    description=(
        "Change a catalogue food by id. Meals already logged keep the nutrition "
        "they snapshotted." + _EDIT_NOTE
    ),
    auth=require_scopes("log"),
)
async def update_food(
    food_id: UUID,
    name: str | None = None,
    brand: str | None = None,
    serving_quantity: float | None = None,
    serving_unit: str | None = None,
    energy_kcal: float | None = None,
    protein_g: float | None = None,
    carbohydrate_g: float | None = None,
    fat_g: float | None = None,
    fiber_g: float | None = None,
    category: str | None = None,
) -> dict[str, Any]:
    changes = {k: v for k, v in locals().items() if k != "food_id"}
    async with get_session_maker()() as session:
        current = await foods_service.get_food(session, food_id)
        data = _merged(FoodReplace, FoodRead.model_validate(current), changes)
        food = await foods_service.replace_food(session, food_id, data)
        return FoodRead.model_validate(food).model_dump(mode="json")


@mcp.tool(
    name="delete_food",
    description=(
        "Delete a catalogue food by id. Meals already logged keep their "
        "snapshotted name and nutrition."
    ),
    auth=require_scopes("log"),
)
async def delete_food(food_id: UUID) -> dict[str, Any]:
    async with get_session_maker()() as session:
        await foods_service.delete_food(session, food_id)
    return _deleted(food_id)


# --- Meals ------------------------------------------------------------------


@mcp.tool(
    name="list_meals",
    description="List logged meals with their items, most recent first.",
    auth=require_scopes("read"),
)
async def list_meals(limit: int = 50, offset: int = 0) -> dict[str, Any]:
    async with get_session_maker()() as session:
        items, total = await meal_entries_service.list_meal_entries(session, limit, offset)
        return _page(MealEntryRead, items, total, limit, offset)


@mcp.tool(
    name="update_meal",
    description=(
        "Change a logged meal by id. Passing items replaces all of the meal's "
        "items (same item shape as log_meal); leaving items out keeps them and "
        "their nutrition unchanged." + _EDIT_NOTE
    ),
    auth=require_scopes("log"),
)
async def update_meal(
    meal_entry_id: UUID,
    consumed_at: datetime | None = None,
    meal_type: str | None = None,
    notes: str | None = None,
    items: list[MealItemCreate] | None = None,
) -> dict[str, Any]:
    changes = {"consumed_at": consumed_at, "meal_type": meal_type, "notes": notes}
    async with get_session_maker()() as session:
        current = MealEntryRead.model_validate(
            await meal_entries_service.get_meal_entry(session, meal_entry_id)
        )
        details = _merged(MealEntryDetails, current, changes)
        if items is None:
            entry = await meal_entries_service.update_meal_entry_details(
                session, meal_entry_id, details
            )
        else:
            data = MealEntryReplace(**details.model_dump(), items=items)
            entry = await meal_entries_service.replace_meal_entry(session, meal_entry_id, data)
        return MealEntryRead.model_validate(entry).model_dump(mode="json")


@mcp.tool(
    name="delete_meal",
    description="Delete a logged meal and its items by id.",
    auth=require_scopes("log"),
)
async def delete_meal(meal_entry_id: UUID) -> dict[str, Any]:
    async with get_session_maker()() as session:
        await meal_entries_service.delete_meal_entry(session, meal_entry_id)
    return _deleted(meal_entry_id)


# --- Finished workouts and activities ---------------------------------------


@mcp.tool(
    name="log_workout",
    description=(
        "Record a finished workout or activity. For a strength workout list its "
        "exercises (exercise_name, sets_count, reps_per_set with one entry per "
        "set, optional weight_kg). For hockey, a swim, a ride, a hike or a run "
        "set activity_type and optionally distance_km and effort_rpe (1-10). "
        "overall_feeling is 1-5; performed_at is a UTC timestamp."
    ),
    auth=require_scopes("log"),
)
async def log_workout(
    performed_at: datetime,
    total_time_minutes: int,
    overall_feeling: int,
    exercises: list[ExerciseLogCreate] | None = None,
    activity_type: ActivityType | None = None,
    distance_km: float | None = None,
    effort_rpe: int | None = None,
    calories_burned: int | None = None,
    notes: str | None = None,
    source_plan_id: UUID | None = None,
) -> dict[str, Any]:
    data = WorkoutLogCreate(
        performed_at=performed_at,
        total_time_minutes=total_time_minutes,
        overall_feeling=overall_feeling,
        exercises=exercises or [],
        activity_type=activity_type,
        distance_km=distance_km,
        effort_rpe=effort_rpe,
        calories_burned=calories_burned,
        notes=notes,
        source_plan_id=source_plan_id,
    )
    async with get_session_maker()() as session:
        log = await logs_service.create_log(session, data)
        return WorkoutLogRead.model_validate(log).model_dump(mode="json")


@mcp.tool(
    name="list_workouts",
    description="List finished workouts and activities, most recent first.",
    auth=require_scopes("read"),
)
async def list_workouts(limit: int = 50, offset: int = 0) -> dict[str, Any]:
    async with get_session_maker()() as session:
        items, total = await logs_service.list_logs(session, limit, offset)
        return _page(WorkoutLogRead, items, total, limit, offset)


@mcp.tool(
    name="update_workout",
    description=(
        "Change a finished workout or activity by id. Passing exercises replaces "
        "the whole exercise list." + _EDIT_NOTE
    ),
    auth=require_scopes("log"),
)
async def update_workout(
    workout_log_id: UUID,
    performed_at: datetime | None = None,
    total_time_minutes: int | None = None,
    overall_feeling: int | None = None,
    exercises: list[ExerciseLogCreate] | None = None,
    activity_type: ActivityType | None = None,
    distance_km: float | None = None,
    effort_rpe: int | None = None,
    calories_burned: int | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    changes = {k: v for k, v in locals().items() if k != "workout_log_id"}
    async with get_session_maker()() as session:
        current = await logs_service.get_log(session, workout_log_id)
        data = _merged(WorkoutLogReplace, WorkoutLogRead.model_validate(current), changes)
        log = await logs_service.replace_log(session, workout_log_id, data)
        return WorkoutLogRead.model_validate(log).model_dump(mode="json")


@mcp.tool(
    name="delete_workout",
    description="Delete a finished workout or activity by id.",
    auth=require_scopes("log"),
)
async def delete_workout(workout_log_id: UUID) -> dict[str, Any]:
    async with get_session_maker()() as session:
        await logs_service.delete_log(session, workout_log_id)
    return _deleted(workout_log_id)


# --- Live workout session ---------------------------------------------------


@mcp.tool(
    name="start_workout_session",
    description=(
        "Start a live workout from a plan, or return the plan's session that is "
        "already running. The result lists each exercise's id for log_set."
    ),
    auth=require_scopes("log"),
)
async def start_workout_session(
    workout_plan_id: UUID, location_id: UUID | None = None
) -> dict[str, Any]:
    async with get_session_maker()() as session:
        workout_session, _ = await workout_sessions_service.start_session(
            session, workout_plan_id, location_id
        )
        return WorkoutSessionRead.model_validate(workout_session).model_dump(mode="json")


@mcp.tool(
    name="get_active_workout_session",
    description="Fetch the live workout session that is running now, with its sets.",
    auth=require_scopes("read"),
)
async def get_active_workout_session() -> dict[str, Any]:
    async with get_session_maker()() as session:
        workout_session = await workout_sessions_service.get_active_session(session)
        return WorkoutSessionRead.model_validate(workout_session).model_dump(mode="json")


@mcp.tool(
    name="update_set",
    description=(
        "Change a set already logged in the live session, by its set entry id." + _EDIT_NOTE
    ),
    auth=require_scopes("log"),
)
async def update_set(
    session_id: UUID,
    set_entry_id: UUID,
    reps: int | None = None,
    weight_kg: float | None = None,
    rir: int | None = None,
    rpe: int | None = None,
    added_weight_kg: float | None = None,
    band_level: str | None = None,
    duration_seconds: int | None = None,
    distance_km: float | None = None,
    incline_percent: float | None = None,
) -> dict[str, Any]:
    changes = {k: v for k, v in locals().items() if k not in ("session_id", "set_entry_id")}
    async with get_session_maker()() as db:
        workout_session = await workout_sessions_service.get_session(db, session_id)
        current = next(
            (
                entry
                for exercise in workout_session.exercises
                for entry in exercise.set_entries
                if entry.id == set_entry_id
            ),
            None,
        )
        if current is None:
            raise NotFoundError("Set entry not found", code="SET_ENTRY_NOT_FOUND")
        data = _merged(SetEntryUpdate, SetEntryRead.model_validate(current), changes)
        workout_session = await workout_sessions_service.update_set(
            db, session_id, set_entry_id, data
        )
        return WorkoutSessionRead.model_validate(workout_session).model_dump(mode="json")


@mcp.tool(
    name="delete_set",
    description="Remove a set from the live session, by its set entry id.",
    auth=require_scopes("log"),
)
async def delete_set(session_id: UUID, set_entry_id: UUID) -> dict[str, Any]:
    async with get_session_maker()() as db:
        workout_session = await workout_sessions_service.delete_set(db, session_id, set_entry_id)
        return WorkoutSessionRead.model_validate(workout_session).model_dump(mode="json")


@mcp.tool(
    name="complete_workout_session",
    description=(
        "Finish the live session. Its completed sets become a finished workout "
        "(see list_workouts); overall_feeling is 1-5."
    ),
    auth=require_scopes("log"),
)
async def complete_workout_session(session_id: UUID, overall_feeling: int) -> dict[str, Any]:
    data = WorkoutSessionComplete(overall_feeling=overall_feeling)
    async with get_session_maker()() as db:
        workout_session = await workout_sessions_service.complete_session(db, session_id, data)
        return WorkoutSessionRead.model_validate(workout_session).model_dump(mode="json")


@mcp.tool(
    name="delete_workout_session",
    description=(
        "Discard a workout session and its sets by id. A finished workout it "
        "already produced stays; remove that with delete_workout."
    ),
    auth=require_scopes("log"),
)
async def delete_workout_session(session_id: UUID) -> dict[str, Any]:
    async with get_session_maker()() as db:
        await workout_sessions_service.delete_session(db, session_id)
    return _deleted(session_id)
