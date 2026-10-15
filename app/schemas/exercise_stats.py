from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ExerciseSessionPoint(BaseModel):
    """One logged session of an exercise, for progression charts."""

    performed_at: datetime
    weight_kg: float | None
    top_reps: int | None
    estimated_one_rep_max_kg: float | None


class ExerciseStatsRead(BaseModel):
    exercise_name: str
    sessions_count: int
    last_performed_at: datetime | None
    last_weight_kg: float | None
    last_reps_per_set: list[int] | None
    best_weight_kg: float | None
    best_weight_reps: int | None
    estimated_one_rep_max_kg: float | None
    trend: Literal["up", "down", "flat"] | None
    # Up to RECENT_SESSIONS most recent sessions, oldest first.
    recent: list[ExerciseSessionPoint] = []


class ExerciseStatsResponse(BaseModel):
    items: list[ExerciseStatsRead]
