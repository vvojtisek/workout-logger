"""What a location can host: flags a workout's exercises that need equipment
the place lacks, suggests swaps, and filters the catalogue.

Exercises are matched to the catalogue by name or alias, ignoring case. An
exercise the catalogue does not know, or one without equipment tags, is never
flagged: the app only warns about what it can actually tell.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise, Location
from app.schemas.workout_sessions import (
    LocationCheckItem,
    LocationCheckRead,
    LocationRef,
    SwapSuggestion,
)
from app.services.equipment import is_available
from app.services.locations import get_location
from app.services.workout_sessions import get_session

MAX_SWAPS = 3


def _catalogue_index(exercises: list[Exercise]) -> dict[str, Exercise]:
    index: dict[str, Exercise] = {}
    for exercise in exercises:
        for name in (exercise.name, *exercise.aliases):
            index.setdefault(name.strip().lower(), exercise)
    return index


def _swap_score(original: Exercise, candidate: Exercise) -> int:
    """Same prime movers count double; shared helpers count once."""
    primary = len(set(original.primary_muscles) & set(candidate.primary_muscles))
    secondary = len(set(original.secondary_muscles) & set(candidate.secondary_muscles))
    return primary * 2 + secondary if primary else 0


def _swap_kind(candidate: Exercise, current_kind: str) -> str:
    if candidate.equipment_any_of == [["bodyweight"]]:
        return "bodyweight"
    return current_kind


def _swaps(
    original: Exercise,
    current_kind: str,
    catalogue: list[Exercise],
    location: Location,
    taken: set[str],
) -> list[SwapSuggestion]:
    scored = [
        (_swap_score(original, candidate), candidate)
        for candidate in catalogue
        if candidate.id != original.id
        and candidate.name.lower() not in taken
        and is_available(candidate.equipment_any_of, location.equipment)
    ]
    ranked = sorted(
        (pair for pair in scored if pair[0] > 0), key=lambda pair: (-pair[0], pair[1].name.lower())
    )
    return [
        SwapSuggestion(
            exercise_name=candidate.name,
            exercise_kind=_swap_kind(candidate, current_kind),  # type: ignore[arg-type]
        )
        for _, candidate in ranked[:MAX_SWAPS]
    ]


async def check_session(session: AsyncSession, session_id: UUID) -> LocationCheckRead:
    workout_session = await get_session(session, session_id)
    if workout_session.location_id is None:
        return LocationCheckRead(location=None, items=[])
    location = await get_location(session, workout_session.location_id)
    catalogue = list((await session.scalars(select(Exercise))).all())
    index = _catalogue_index(catalogue)
    taken = {exercise.exercise_name.strip().lower() for exercise in workout_session.exercises}

    items: list[LocationCheckItem] = []
    for exercise in workout_session.exercises:
        if exercise.set_entries:
            continue
        known = index.get(exercise.exercise_name.strip().lower())
        if known is None or is_available(known.equipment_any_of, location.equipment):
            continue
        items.append(
            LocationCheckItem(
                session_exercise_id=exercise.id,
                exercise_name=exercise.exercise_name,
                needs=known.equipment_any_of,
                swaps=_swaps(known, exercise.exercise_kind, catalogue, location, taken),
            )
        )
    return LocationCheckRead(location=LocationRef(id=location.id, name=location.name), items=items)


async def filter_available(
    session: AsyncSession, exercises: list[Exercise], location_id: UUID
) -> list[Exercise]:
    location = await get_location(session, location_id)
    return [e for e in exercises if is_available(e.equipment_any_of, location.equipment)]
