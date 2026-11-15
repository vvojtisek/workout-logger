"""What the last 3-5 sessions of an exercise say about today, and how
today's readiness check-in scales a load (app/services/readiness_score.py)."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ExerciseLog, PlanExercise, ReadinessLog, WorkoutLog, WorkoutPlan
from app.schemas.coach import BaselineSession, ExerciseBaseline, ReadinessAdjustment
from app.services.next_session import (
    HISTORY_SESSIONS,
    catalogue_match,
    increment_for,
    suggest_next,
)
from app.services.progression import Suggestion, round_to_step
from app.services.readiness import latest_for_session_start, reason_for
from app.services.readiness_score import exercise_factor

NOTE_LENGTH = 120
DEFAULT_REP_RANGE = (8, 12)


def e1rm(weight_kg: float | None, reps: int) -> float | None:
    """Epley; less accurate above about 12 reps."""
    if not weight_kg or reps <= 0:
        return None
    return round(weight_kg * (1 + reps / 30), 1)


def _sets(log: ExerciseLog) -> list[tuple[float | None, int]]:
    return list(log.sets_with_weights)


def baseline_session(log: ExerciseLog, performed_at: datetime) -> BaselineSession:
    sets = _sets(log)
    loads = [weight for weight, _ in sets if weight]
    best = max((e1rm(weight, reps) or 0.0 for weight, reps in sets), default=0.0)
    return BaselineSession(
        date=performed_at.date(),
        reps_per_set=list(log.reps_per_set),
        weight_kg=log.weight_kg,
        top_set_kg=max(loads) if loads else None,
        e1rm_kg=best or None,
    )


async def recent_sessions(
    session: AsyncSession, exercise_name: str, limit: int = HISTORY_SESSIONS
) -> list[BaselineSession]:
    rows = (
        await session.execute(
            select(ExerciseLog, WorkoutLog.performed_at)
            .join(WorkoutLog, ExerciseLog.workout_log_id == WorkoutLog.id)
            .where(
                func.lower(func.trim(ExerciseLog.exercise_name)) == exercise_name.strip().lower()
            )
            .order_by(WorkoutLog.performed_at.desc())
            .limit(limit)
        )
    ).all()
    return [baseline_session(log, performed_at) for log, performed_at in rows]


@dataclass(frozen=True)
class Adjusted:
    weight_kg: float | None
    factor: float
    note: str | None


def _note(*parts: str | None) -> str | None:
    text = " · ".join(part for part in parts if part)
    if not text:
        return None
    return text if len(text) <= NOTE_LENGTH else text[: NOTE_LENGTH - 1].rstrip() + "…"


async def adjust_for_readiness(
    session: AsyncSession,
    *,
    check_in: ReadinessLog | None,
    exercise_name: str,
    catalog_exercise_id: UUID | None,
    weight_kg: float | None,
    base_note: str | None,
    label: str = "Adjusted",
) -> Adjusted:
    """Scales a load by the check-in's factor, rounded to the exercise's
    increment. No check-in, no load, or a factor of 1.0 leaves it alone."""
    if check_in is None or not weight_kg:
        return Adjusted(weight_kg=weight_kg, factor=1.0, note=base_note)
    match = await catalogue_match(session, exercise_name, catalog_exercise_id)
    muscles = set(match.primary_muscles) if match is not None else set()
    factor = exercise_factor(check_in.inputs, muscles)
    if factor >= 1.0:
        return Adjusted(weight_kg=weight_kg, factor=1.0, note=base_note)
    step = await increment_for(session, exercise_name, catalog_exercise_id)
    adjusted = round_to_step(weight_kg * factor, step)
    percent = round((1 - factor) * 100)
    reason = await reason_for(session, check_in)
    return Adjusted(
        weight_kg=adjusted,
        factor=factor,
        note=_note(f"{label} -{percent}% for {reason}", base_note),
    )


async def _rep_range(session: AsyncSession, exercise_name: str) -> tuple[int, int, float | None]:
    latest = await session.scalar(
        select(PlanExercise)
        .join(WorkoutPlan, PlanExercise.workout_plan_id == WorkoutPlan.id)
        .where(func.lower(func.trim(PlanExercise.exercise_name)) == exercise_name.strip().lower())
        .order_by(WorkoutPlan.updated_at.desc())
        .limit(1)
    )
    if latest is None:
        return (*DEFAULT_REP_RANGE, None)
    return latest.target_reps_min, latest.target_reps_max, latest.target_weight_kg


async def exercise_baseline(
    session: AsyncSession,
    exercise_name: str,
    *,
    plan_id: UUID | None = None,
    rep_min: int | None = None,
    rep_max: int | None = None,
    catalog_exercise_id: UUID | None = None,
) -> ExerciseBaseline:
    default_min, default_max, plan_weight = await _rep_range(session, exercise_name)
    low = rep_min or default_min
    high = max(rep_max or default_max, low)
    suggestion: Suggestion = await suggest_next(
        session,
        exercise_name=exercise_name,
        plan_id=plan_id,
        rep_min=low,
        rep_max=high,
        plan_weight_kg=plan_weight,
        catalog_exercise_id=catalog_exercise_id,
    )
    check_in = await latest_for_session_start(session)
    adjusted = await adjust_for_readiness(
        session,
        check_in=check_in,
        exercise_name=exercise_name,
        catalog_exercise_id=catalog_exercise_id,
        weight_kg=suggestion.weight_kg,
        base_note=suggestion.note,
    )
    readiness = (
        None
        if check_in is None
        else ReadinessAdjustment(
            score=check_in.score,
            load_factor=adjusted.factor,
            reason=await reason_for(session, check_in),
            logged_at=check_in.logged_at,
        )
    )
    return ExerciseBaseline(
        exercise_name=exercise_name,
        sessions=await recent_sessions(session, exercise_name),
        progression_weight_kg=suggestion.weight_kg,
        progression_reps=suggestion.reps,
        progression_note=suggestion.note,
        readiness=readiness,
        suggested_weight_kg=adjusted.weight_kg,
        suggested_reps=suggestion.reps,
        note=adjusted.note,
    )
