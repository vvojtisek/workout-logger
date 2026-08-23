from fastapi import APIRouter, Security

from app.api.v1 import (
    api_tokens,
    body_metrics,
    calendar,
    exercises,
    foods,
    logs,
    meal_entries,
    nutrition_dashboard,
    nutrition_plans,
    plans,
    programs,
    scheduled_workouts,
    sleep_entries,
    workout_sessions,
)
from app.security import require_api_key

api_router = APIRouter(prefix="/api/v1", dependencies=[Security(require_api_key)])
api_router.include_router(api_tokens.router)
api_router.include_router(plans.router)
api_router.include_router(exercises.router)
api_router.include_router(logs.router)
api_router.include_router(workout_sessions.router)
api_router.include_router(programs.router)
api_router.include_router(scheduled_workouts.router)
api_router.include_router(calendar.router)
api_router.include_router(body_metrics.router)
api_router.include_router(foods.router)
api_router.include_router(nutrition_plans.router)
api_router.include_router(meal_entries.router)
api_router.include_router(nutrition_dashboard.router)
api_router.include_router(sleep_entries.router)
