from datetime import datetime
from typing import Literal

from pydantic import BaseModel


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


class ExerciseStatsResponse(BaseModel):
    items: list[ExerciseStatsRead]
