from fastapi import APIRouter, Security

from app.api.v1 import (
    api_tokens,
    audit_events,
    body_metrics,
    calendar,
    coaching_principles,
    exercise_stats,
    exercises,
    export,
    food_catalog,
    foods,
    ingest,
    invites,
    load_events,
    locations,
    logs,
    mcp_status,
    meal_entries,
    nutrition_dashboard,
    nutrition_plans,
    plans,
    program_templates,
    programs,
    scheduled_workouts,
    settings,
    sleep_entries,
    users,
    workout_sessions,
)
from app.security import require_api_key

api_router = APIRouter(prefix="/api/v1", dependencies=[Security(require_api_key)])
api_router.include_router(api_tokens.router)
api_router.include_router(invites.router)
api_router.include_router(users.router)
api_router.include_router(plans.router)
api_router.include_router(exercises.router)
api_router.include_router(load_events.router)
api_router.include_router(locations.router)
api_router.include_router(logs.router)
api_router.include_router(exercise_stats.router)
api_router.include_router(workout_sessions.router)
api_router.include_router(programs.router)
api_router.include_router(program_templates.router)
api_router.include_router(scheduled_workouts.router)
api_router.include_router(calendar.router)
api_router.include_router(body_metrics.router)
api_router.include_router(foods.router)
api_router.include_router(food_catalog.router)
api_router.include_router(nutrition_plans.router)
api_router.include_router(meal_entries.router)
api_router.include_router(nutrition_dashboard.router)
api_router.include_router(sleep_entries.router)
api_router.include_router(ingest.router)
api_router.include_router(settings.router)
api_router.include_router(coaching_principles.router)
api_router.include_router(mcp_status.router)
api_router.include_router(export.router)
api_router.include_router(audit_events.router)
