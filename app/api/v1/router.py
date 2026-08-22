from fastapi import APIRouter, Security

from app.api.v1 import (
    calendar,
    exercises,
    logs,
    plans,
    programs,
    scheduled_workouts,
    workout_sessions,
)
from app.security import require_api_key

api_router = APIRouter(prefix="/api/v1", dependencies=[Security(require_api_key)])
api_router.include_router(plans.router)
api_router.include_router(exercises.router)
api_router.include_router(logs.router)
api_router.include_router(workout_sessions.router)
api_router.include_router(programs.router)
api_router.include_router(scheduled_workouts.router)
api_router.include_router(calendar.router)
