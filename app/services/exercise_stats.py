from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from math import exp
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ExerciseLog, WorkoutLog
from app.schemas.exercise_stats import (
    ExerciseSessionPoint,
    ExerciseStatsRead,
    FormulaAgreement,
    OneRepMaxFormula,
    RepRetentionGroup,
)

# Sessions returned for progression charts.
RECENT_SESSIONS = 12
ALTERNATE_FORMULA_MAX_REPS = 10
ALL_FORMULAS: tuple[OneRepMaxFormula, ...] = ("epley", "brzycki", "lombardi", "wathen")


def _normalize(name: str) -> str:
    return name.strip().lower()


def _estimated_one_rep_max(
    weight_kg: float, reps: int, formula: OneRepMaxFormula, rir: int | None = None
) -> float:
    effective_reps = reps + (rir or 0)
    match formula:
        case "epley":
            estimate = weight_kg * (1 + effective_reps / 30)
        case "brzycki":
            estimate = weight_kg / (1.0278 - 0.0278 * effective_reps)
        case "lombardi":
            estimate = weight_kg * effective_reps**0.1
        case "wathen":
            estimate = weight_kg / (0.488 + 0.538 * exp(-0.075 * effective_reps))
    return round(estimate * 2) / 2


def _best_estimated_set(
    loaded: Iterable[tuple[float, int, int | None]], formula: OneRepMaxFormula
) -> tuple[float, float, int] | None:
    return max(
        (
            (_estimated_one_rep_max(weight, reps, formula, rir), weight, reps)
            for weight, reps, rir in loaded
            if formula == "epley" or 1 <= reps + (rir or 0) <= ALTERNATE_FORMULA_MAX_REPS
        ),
        default=None,
    )


def _recent_point(
    performed_at: datetime, entry: ExerciseLog, formula: OneRepMaxFormula
) -> ExerciseSessionPoint:
    best = _best_estimated_set(
        ((weight, reps, rir) for weight, reps, rir in entry.sets_with_effort if weight),
        formula,
    )
    if best is None:
        return ExerciseSessionPoint(
            performed_at=performed_at,
            weight_kg=entry.weight_kg,
            top_reps=max(entry.reps_per_set, default=None),
            estimated_one_rep_max_kg=None,
        )
    estimate, weight, reps = best
    return ExerciseSessionPoint(
        performed_at=performed_at,
        weight_kg=weight,
        top_reps=reps,
        estimated_one_rep_max_kg=estimate,
    )


def _same_load_rep_retention(entry: ExerciseLog) -> list[RepRetentionGroup]:
    """Compare repetitions and reported RIR across sets at a repeated load."""
    sets_by_load: dict[float, list[tuple[int, int | None]]] = {}
    rir_by_set = entry.rir_per_set or []
    for index, (weight, reps) in enumerate(entry.sets_with_weights):
        if weight is not None:
            rir = rir_by_set[index] if index < len(rir_by_set) else None
            sets_by_load.setdefault(round(weight, 3), []).append((reps, rir))

    return [
        RepRetentionGroup(
            weight_kg=weight,
            reps_per_set=[reps for reps, _ in sets],
            rir_per_set=[rir for _, rir in sets],
            retention_percent=round(sets[-1][0] / sets[0][0] * 100, 1),
        )
        for weight, sets in sets_by_load.items()
        if len(sets) >= 2 and sets[0][0] > 0
    ]


def _formula_agreement(entry: ExerciseLog) -> FormulaAgreement | None:
    """Compare equations on the same heaviest set in their shared 1–10 rep range."""
    eligible = [
        (weight, reps)
        for weight, reps in entry.sets_with_weights
        if weight is not None and weight > 0 and 1 <= reps <= ALTERNATE_FORMULA_MAX_REPS
    ]
    if not eligible:
        return None

    weight, reps = max(eligible)
    estimates = {formula: _estimated_one_rep_max(weight, reps, formula) for formula in ALL_FORMULAS}
    mean = sum(estimates.values()) / len(estimates)
    spread_percent = (max(estimates.values()) - min(estimates.values())) / mean * 100
    return FormulaAgreement(
        reference_weight_kg=weight,
        reference_reps=reps,
        estimates_kg=estimates,
        spread_percent=round(spread_percent, 1),
    )


def _summarize(
    name: str, history: list[tuple[datetime, ExerciseLog]], formula: OneRepMaxFormula
) -> ExerciseStatsRead:
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
            formula_agreement=None,
            rep_retention=[],
        )

    # `history` is newest first.
    last_performed_at, last = history[0]
    # A historical working weight can differ from the weight of any given set.
    loaded = [
        (weight, reps, rir)
        for _, entry in history
        for weight, reps, rir in entry.sets_with_effort
        if weight
    ]

    best_weight_kg = None
    best_weight_reps = None
    if loaded:
        best_weight_kg, best_weight_reps = max((weight, reps) for weight, reps, _ in loaded)
    best_estimated_set = _best_estimated_set(loaded, formula)

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

    recent = [
        _recent_point(performed_at, entry, formula)
        for performed_at, entry in reversed(history[:RECENT_SESSIONS])
    ]

    return ExerciseStatsRead(
        exercise_name=name,
        sessions_count=len(history),
        recent=recent,
        last_performed_at=last_performed_at,
        last_weight_kg=last.weight_kg,
        last_reps_per_set=list(last.reps_per_set),
        best_weight_kg=best_weight_kg,
        best_weight_reps=best_weight_reps,
        estimated_one_rep_max_kg=best_estimated_set[0] if best_estimated_set else None,
        trend=trend,
        formula_agreement=_formula_agreement(last),
        rep_retention=_same_load_rep_retention(last),
    )


async def get_exercise_stats(
    session: AsyncSession,
    names: list[str],
    formula: OneRepMaxFormula = "epley",
    *,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[ExerciseStatsRead]:
    """Summarize logged history per exercise name, matched case-insensitively.

    Reads only completed workout logs; owner scoping is applied by the session's
    loader criteria, so each account sees statistics for its own history only.
    """
    wanted = {_normalize(name) for name in names}
    statement = (
        select(WorkoutLog.performed_at, ExerciseLog)
        .join(WorkoutLog, ExerciseLog.workout_log_id == WorkoutLog.id)
        .where(func.lower(func.trim(ExerciseLog.exercise_name)).in_(wanted))
        .order_by(WorkoutLog.performed_at.desc(), ExerciseLog.sort_order)
    )
    if date_from is not None and date_to is not None:
        statement = statement.where(
            WorkoutLog.performed_at >= date_from, WorkoutLog.performed_at < date_to
        )
    result = await session.execute(statement)
    history: dict[str, list[tuple[datetime, ExerciseLog]]] = defaultdict(list)
    for performed_at, entry in result.all():
        history[_normalize(entry.exercise_name)].append((performed_at, entry))
    return [_summarize(name, history[_normalize(name)], formula) for name in names]
