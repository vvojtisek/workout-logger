"""Looks up each logged exercise's volume rule in the exercise catalogue.

Logs and sessions keep only the exercise name, so the rule is matched by name
or alias, without case. An exercise the account owns wins over a shared one
with the same name; a name the catalogue does not know counts as a standard
lift (weight x reps).
"""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise, WorkoutLog, WorkoutSession
from app.services.volume import DEFAULT_RULE, VolumeRule


def _key(name: str) -> str:
    return name.strip().lower()


async def rules_by_name(session: AsyncSession, names: Iterable[str]) -> dict[str, VolumeRule]:
    """Rules keyed by lower-cased name; names with no match are left out."""
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
        )
    )
    rules: dict[str, VolumeRule] = {}
    # Shared rows first, so an owned exercise of the same name overwrites them.
    rows = sorted(result.all(), key=lambda row: row.owner_id is not None)
    for row in rows:
        rule = VolumeRule(row.equipment_load_mode, bool(row.is_unilateral))
        for alias in row.aliases or []:
            if _key(alias) in wanted:
                rules[_key(alias)] = rule
        if _key(row.name) in wanted:
            rules[_key(row.name)] = rule
    return rules


def rule_for(rules: dict[str, VolumeRule], name: str) -> VolumeRule:
    return rules.get(_key(name), DEFAULT_RULE)


async def apply_to_logs(session: AsyncSession, logs: Iterable[WorkoutLog]) -> None:
    logs = list(logs)
    exercises = [exercise for log in logs for exercise in log.exercises]
    rules = await rules_by_name(session, (exercise.exercise_name for exercise in exercises))
    for exercise in exercises:
        exercise.volume_rule = rule_for(rules, exercise.exercise_name)


async def apply_to_session(session: AsyncSession, workout_session: WorkoutSession) -> None:
    rules = await rules_by_name(
        session, (exercise.exercise_name for exercise in workout_session.exercises)
    )
    for exercise in workout_session.exercises:
        exercise.volume_rule = rule_for(rules, exercise.exercise_name)
