from collections import defaultdict
from datetime import datetime
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ExerciseLog, WorkoutLog
from app.schemas.exercise_stats import ExerciseStatsRead


def _normalize(name: str) -> str:
    return name.strip().lower()


def _estimated_one_rep_max(weight_kg: float, reps: int) -> float:
    """Epley estimate, rounded to the nearest 0.5 kg like a loadable plate step."""
    return round(weight_kg * (1 + reps / 30) * 2) / 2


def _summarize(name: str, history: list[tuple[datetime, ExerciseLog]]) -> ExerciseStatsRead:
    if not history:
        return ExerciseStatsRead(
            exercise_name=name,
            sessions_count=0,
            last_performed_at=None,
            last_weight_kg=None,
            last_reps_per_set=None,
            best_weight_kg=None,
            best_weight_reps=None,
            estimated_one_rep_max_kg=None,
            trend=None,
        )

    # `history` is newest first.
    last_performed_at, last = history[0]
    # (load, top reps) per loaded session; bodyweight-only entries carry no load.
    loaded = [
        (entry.weight_kg, max(entry.reps_per_set))
        for _, entry in history
        if entry.weight_kg and entry.reps_per_set
    ]

    best_weight_kg = None
    best_weight_reps = None
    estimated_one_rep_max_kg = None
    if loaded:
        best_weight_kg, best_weight_reps = max(loaded)
        estimated_one_rep_max_kg = max(
            _estimated_one_rep_max(weight, reps) for weight, reps in loaded
        )

    trend: Literal["up", "down", "flat"] | None = None
    newest_load = history[0][1].weight_kg
    previous_load = history[1][1].weight_kg if len(history) > 1 else None
    if newest_load and previous_load:
        if newest_load > previous_load:
            trend = "up"
        elif newest_load < previous_load:
            trend = "down"
        else:
            trend = "flat"

    return ExerciseStatsRead(
        exercise_name=name,
        sessions_count=len(history),
        last_performed_at=last_performed_at,
        last_weight_kg=last.weight_kg,
        last_reps_per_set=list(last.reps_per_set),
        best_weight_kg=best_weight_kg,
        best_weight_reps=best_weight_reps,
        estimated_one_rep_max_kg=estimated_one_rep_max_kg,
        trend=trend,
    )


async def get_exercise_stats(session: AsyncSession, names: list[str]) -> list[ExerciseStatsRead]:
    """Summarize logged history per exercise name, matched case-insensitively.

    Reads only completed workout logs; owner scoping is applied by the session's
    loader criteria, so each account sees statistics for its own history only.
    """
    wanted = {_normalize(name) for name in names}
    result = await session.execute(
        select(WorkoutLog.performed_at, ExerciseLog)
        .join(WorkoutLog, ExerciseLog.workout_log_id == WorkoutLog.id)
        .where(func.lower(func.trim(ExerciseLog.exercise_name)).in_(wanted))
        .order_by(WorkoutLog.performed_at.desc(), ExerciseLog.sort_order)
    )
    history: dict[str, list[tuple[datetime, ExerciseLog]]] = defaultdict(list)
    for performed_at, entry in result.all():
        history[_normalize(entry.exercise_name)].append((performed_at, entry))
    return [_summarize(name, history[_normalize(name)]) for name in names]
