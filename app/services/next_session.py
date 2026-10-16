"""Feeds a workout's history into the double progression rules
(`app/services/progression.py`) when a session starts or an exercise is
swapped. History is the last two logged sessions of the exercise; RIR comes
from the live session that produced a log, when there was one."""

import re
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Exercise, ExerciseLog, SessionExercise, WorkoutLog, WorkoutSession
from app.services.load_warnings import LEG_MUSCLES, LEG_NAME
from app.services.progression import SessionResult, Suggestion, load_increment, suggest

HISTORY_SESSIONS = 2
_NOT_BARBELL = re.compile(r"dumbbell|kettlebell|goblet|band|cable|machine|smith", re.IGNORECASE)


def _normalize(name: str) -> str:
    return name.strip().lower()


async def _catalogue_match(
    session: AsyncSession, exercise_name: str, catalog_exercise_id: UUID | None
) -> Exercise | None:
    if catalog_exercise_id is not None:
        linked = await session.scalar(select(Exercise).where(Exercise.id == catalog_exercise_id))
        if linked is not None:
            return linked
    wanted = _normalize(exercise_name)
    for exercise in (await session.scalars(select(Exercise))).all():
        if wanted in {_normalize(name) for name in (exercise.name, *exercise.aliases)}:
            return exercise
    return None


async def increment_for(
    session: AsyncSession, exercise_name: str, catalog_exercise_id: UUID | None = None
) -> float:
    match = await _catalogue_match(session, exercise_name, catalog_exercise_id)
    if match is not None:
        leg = bool(LEG_MUSCLES & set(match.primary_muscles))
        barbell = any(
            "barbell" in option or "trap_bar" in option for option in match.equipment_any_of
        )
    else:
        leg = bool(LEG_NAME.search(exercise_name))
        barbell = not _NOT_BARBELL.search(exercise_name)
    return load_increment(leg=leg, barbell=barbell)


async def _rir_for(session: AsyncSession, log: ExerciseLog) -> list[int | None] | None:
    live = await session.scalar(
        select(WorkoutSession)
        .options(selectinload(WorkoutSession.exercises).selectinload(SessionExercise.set_entries))
        .where(WorkoutSession.workout_log_id == log.workout_log_id)
    )
    if live is None:
        return None
    for exercise in live.exercises:
        if _normalize(exercise.exercise_name) == _normalize(log.exercise_name):
            entries = sorted(
                (entry for entry in exercise.set_entries if entry.state == "completed"),
                key=lambda entry: entry.set_number,
            )
            return [entry.rir for entry in entries]
    return None


async def history(
    session: AsyncSession, exercise_name: str, plan_id: UUID | None
) -> list[SessionResult]:
    """Newest first. Within a plan the name must match exactly, as the plan
    wrote it; a swapped-in exercise matches by name across all logs."""
    statement = select(ExerciseLog).join(WorkoutLog, ExerciseLog.workout_log_id == WorkoutLog.id)
    if plan_id is not None:
        statement = statement.where(
            WorkoutLog.source_plan_id == plan_id, ExerciseLog.exercise_name == exercise_name
        )
    else:
        statement = statement.where(
            func.lower(func.trim(ExerciseLog.exercise_name)) == _normalize(exercise_name)
        )
    logs = (
        await session.scalars(
            statement.order_by(WorkoutLog.performed_at.desc()).limit(HISTORY_SESSIONS)
        )
    ).all()
    return [
        SessionResult(
            weight_kg=log.weight_kg,
            reps=list(log.reps_per_set),
            rir=await _rir_for(session, log),
        )
        for log in logs
    ]


async def suggest_next(
    session: AsyncSession,
    *,
    exercise_name: str,
    plan_id: UUID | None,
    rep_min: int,
    rep_max: int,
    plan_weight_kg: float | None,
    catalog_exercise_id: UUID | None = None,
) -> Suggestion:
    return suggest(
        await history(session, exercise_name, plan_id),
        rep_min=rep_min,
        rep_max=rep_max,
        plan_weight_kg=plan_weight_kg,
        increment_kg=await increment_for(session, exercise_name, catalog_exercise_id),
    )
