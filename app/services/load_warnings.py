"""Flags heavy leg work scheduled shortly before a hockey game or practice.

The rule: a scheduled workout is flagged when its plan has heavy leg work and
a game falls within 24 hours after it, or a practice within 12 hours. Heavy
leg work is a strength or bodyweight exercise for the quads, glutes or
hamstrings (squat, hinge and lunge patterns) whose rep range starts at 6 or
fewer. Exercises are matched to the catalogue by link, name or alias; an
exercise the catalogue does not know counts when its name says squat,
deadlift, lunge and the like.

Scheduled workouts have a date but no time, so the windows are read as: a game
on the same day or the next day, a practice on the same day or before noon
the next day. This only warns; nothing is moved on its own.
"""

import re
from datetime import date, time, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Exercise, PlanExercise, ScheduledWorkout, WorkoutPlan
from app.schemas.load_events import LoadEventOccurrence
from app.schemas.load_warnings import LoadWarning, PlanRef
from app.services.load_events import get_occurrences

LEG_MUSCLES = frozenset({"quads", "glutes", "hamstrings"})
HEAVY_REPS = 6
# A practice the next day only counts when it starts before this time.
NEXT_DAY_PRACTICE_CUTOFF = time(12, 0)
MOVE_SEARCH_DAYS = 3
MAX_SWAP_PLANS = 5

LEG_NAME = re.compile(
    r"squat|deadlift|\brdl\b|lunge|leg press|hip thrust|step[- ]?up|good morning",
    re.IGNORECASE,
)


def _catalogue_index(exercises: list[Exercise]) -> dict[str, Exercise]:
    index: dict[str, Exercise] = {}
    for exercise in exercises:
        for name in (exercise.name, *exercise.aliases):
            index.setdefault(name.strip().lower(), exercise)
    return index


def _is_leg_exercise(
    item: PlanExercise, by_id: dict[UUID, Exercise], by_name: dict[str, Exercise]
) -> bool:
    match = (by_id.get(item.catalog_exercise_id) if item.catalog_exercise_id else None) or (
        by_name.get(item.exercise_name.strip().lower())
    )
    if match is not None:
        return bool(LEG_MUSCLES & set(match.primary_muscles))
    return bool(LEG_NAME.search(item.exercise_name))


def heavy_leg_exercises(
    plan: WorkoutPlan, by_id: dict[UUID, Exercise], by_name: dict[str, Exercise]
) -> list[str]:
    return [
        item.exercise_name
        for item in sorted(plan.exercises, key=lambda item: item.sort_order)
        if item.exercise_kind != "cardio"
        and item.target_reps_min <= HEAVY_REPS
        and _is_leg_exercise(item, by_id, by_name)
    ]


def clashes(day: date, occurrences: list[LoadEventOccurrence]) -> list[LoadEventOccurrence]:
    """The games and practices a workout on `day` would come too close before."""
    next_day = day + timedelta(days=1)
    found = []
    for occurrence in occurrences:
        if occurrence.date == day:
            found.append(occurrence)
        elif occurrence.date == next_day and (
            occurrence.kind == "game" or occurrence.start_time < NEXT_DAY_PRACTICE_CUTOFF
        ):
            found.append(occurrence)
    return found


def _move_to(
    day: date,
    occurrences: list[LoadEventOccurrence],
    taken: set[date],
) -> date | None:
    """The nearest day, earlier first, with no other workout and no clash."""
    for offset in range(1, MOVE_SEARCH_DAYS + 1):
        for candidate in (day - timedelta(days=offset), day + timedelta(days=offset)):
            if candidate not in taken and not clashes(candidate, occurrences):
                return candidate
    return None


async def get_warnings(
    session: AsyncSession,
    scheduled: list[ScheduledWorkout],
    date_from: date,
    date_to: date,
) -> list[LoadWarning]:
    candidates = [item for item in scheduled if item.status == "scheduled"]
    if not candidates:
        return []
    # Look past both ends: a clash can sit the day after the range, and a
    # suggested move can land up to MOVE_SEARCH_DAYS outside it.
    reach = timedelta(days=MOVE_SEARCH_DAYS + 1)
    occurrences = await get_occurrences(session, date_from - reach, date_to + reach)
    if not occurrences:
        return []

    plans = list(
        (
            await session.scalars(
                select(WorkoutPlan)
                .options(selectinload(WorkoutPlan.exercises))
                .order_by(WorkoutPlan.name.asc())
            )
        ).all()
    )
    catalogue = list((await session.scalars(select(Exercise))).all())
    by_id = {exercise.id: exercise for exercise in catalogue}
    by_name = _catalogue_index(catalogue)
    heavy_by_plan = {plan.id: heavy_leg_exercises(plan, by_id, by_name) for plan in plans}
    swap_plans = [
        PlanRef(id=plan.id, name=plan.name)
        for plan in plans
        if plan.exercises and not heavy_by_plan[plan.id]
    ][:MAX_SWAP_PLANS]

    taken_rows = await session.execute(
        select(ScheduledWorkout.scheduled_date).where(
            ScheduledWorkout.scheduled_date >= date_from - reach,
            ScheduledWorkout.scheduled_date <= date_to + reach,
        )
    )
    taken = {row[0] for row in taken_rows}

    warnings = []
    for item in candidates:
        heavy = heavy_by_plan.get(item.workout_plan_id, [])
        if not heavy:
            continue
        events = clashes(item.scheduled_date, occurrences)
        if not events:
            continue
        warnings.append(
            LoadWarning(
                scheduled_workout_id=item.id,
                heavy_exercises=heavy,
                events=events,
                move_to=_move_to(item.scheduled_date, occurrences, taken),
                swap_plans=swap_plans,
            )
        )
    return warnings
