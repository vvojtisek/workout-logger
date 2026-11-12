"""Looks up each logged exercise's volume rule in the exercise catalogue.

Logs and sessions keep only the exercise name, so the rule is matched by name
or alias, without case. An exercise the account owns wins over a shared one
with the same name; a name the catalogue does not know counts as a standard
lift (weight x reps).
"""

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise, WorkoutLog, WorkoutSession
from app.services.volume import DEFAULT_RULE, VolumeRule


@dataclass(frozen=True)
class CatalogueVolumeProfile:
    rule: VolumeRule
    primary_muscles: tuple[str, ...] = ()
    equipment_any_of: tuple[tuple[str, ...], ...] = ()
    movement_pattern: str | None = None


DEFAULT_PROFILE = CatalogueVolumeProfile(DEFAULT_RULE)


def _key(name: str) -> str:
    return name.strip().lower()


async def _profiles_by_name(
    session: AsyncSession, names: Iterable[str]
) -> dict[str, CatalogueVolumeProfile]:
    wanted = {_key(name) for name in names}
    if not wanted:
        return {}
    result = await session.execute(
        select(
            Exercise.name,
            Exercise.aliases,
            Exercise.owner_id,
            Exercise.equipment_load_mode,
            Exercise.is_unilateral,
            Exercise.primary_muscles,
            Exercise.equipment_any_of,
            Exercise.movement_pattern,
        )
    )
    profiles: dict[str, CatalogueVolumeProfile] = {}
    # Shared rows first, so an owned exercise of the same name overwrites them.
    rows = sorted(result.all(), key=lambda row: row.owner_id is not None)
    for row in rows:
        profile = CatalogueVolumeProfile(
            VolumeRule(row.equipment_load_mode, bool(row.is_unilateral)),
            tuple(row.primary_muscles or ()),
            tuple(tuple(option) for option in row.equipment_any_of or ()),
            row.movement_pattern,
        )
        for alias in row.aliases or []:
            if _key(alias) in wanted:
                profiles[_key(alias)] = profile
        if _key(row.name) in wanted:
            profiles[_key(row.name)] = profile
    return profiles


def profile_for(profiles: dict[str, CatalogueVolumeProfile], name: str) -> CatalogueVolumeProfile:
    return profiles.get(_key(name), DEFAULT_PROFILE)


async def apply_to_logs(
    session: AsyncSession, logs: Iterable[WorkoutLog]
) -> dict[str, CatalogueVolumeProfile]:
    exercises = [exercise for log in logs for exercise in log.exercises]
    profiles = await _profiles_by_name(session, (exercise.exercise_name for exercise in exercises))
    for exercise in exercises:
        exercise.volume_rule = profile_for(profiles, exercise.exercise_name).rule
    return profiles


async def apply_to_session(session: AsyncSession, workout_session: WorkoutSession) -> None:
    profiles = await _profiles_by_name(
        session, (exercise.exercise_name for exercise in workout_session.exercises)
    )
    for exercise in workout_session.exercises:
        profile = profile_for(profiles, exercise.exercise_name)
        exercise.volume_rule = profile.rule
        exercise.equipment_any_of = profile.equipment_any_of
