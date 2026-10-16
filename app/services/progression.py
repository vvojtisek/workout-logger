"""Double progression: the app's one rule for the next session's load and reps.

For each exercise the plan keeps a rep range. After a session:

- Every set at the top of the range, with 1 or more reps in reserve (RIR):
  add load. +2.5 kg on lower-body barbell lifts, +1 kg on everything else.
  A set logged without RIR counts as having reps in reserve.
- Two sessions in a row at the same load with a set below the bottom of the
  range: drop the load by 10%, rounded to the nearest increment step.
- Otherwise: the same load, aiming for one more rep than the weakest set.

Exercises without a load (bodyweight) progress reps only. These rules are
deliberately fixed in code; an assistant over MCP can read them but not
change them.
"""

import math
from dataclasses import dataclass

LOWER_BARBELL_INCREMENT_KG = 2.5
OTHER_INCREMENT_KG = 1.0
DELOAD_FACTOR = 0.9
MIN_RIR_TO_ADD_LOAD = 1


@dataclass(frozen=True)
class SessionResult:
    """One past session of an exercise, newest first in a history list."""

    weight_kg: float | None
    reps: list[int]
    # Per set, when it was logged; None when the history has no RIR at all.
    rir: list[int | None] | None = None


@dataclass(frozen=True)
class Suggestion:
    weight_kg: float | None
    reps: int
    source: str  # "plan" or "history"
    note: str | None


def load_increment(*, leg: bool, barbell: bool) -> float:
    return LOWER_BARBELL_INCREMENT_KG if leg and barbell else OTHER_INCREMENT_KG


def _format_kg(value: float) -> str:
    return f"{value:g}"


def _round_to_step(value: float, step: float) -> float:
    # Nearest step; a tie rounds down, the safer side after a miss.
    steps = math.floor(value / step + 0.5 - 1e-9)
    return round(max(steps, 0) * step, 2)


def _misses(result: SessionResult, rep_min: int) -> bool:
    return bool(result.reps) and min(result.reps) < rep_min


def _has_reserve(result: SessionResult) -> bool:
    if result.rir is None:
        return True
    return all(value is None or value >= MIN_RIR_TO_ADD_LOAD for value in result.rir)


def suggest(
    history: list[SessionResult],
    *,
    rep_min: int,
    rep_max: int,
    plan_weight_kg: float | None,
    increment_kg: float,
) -> Suggestion:
    sessions = [item for item in history if item.reps]
    if not sessions:
        return Suggestion(weight_kg=plan_weight_kg, reps=rep_min, source="plan", note=None)
    latest = sessions[0]
    weight = latest.weight_kg

    if (
        weight
        and len(sessions) > 1
        and sessions[1].weight_kg == weight
        and _misses(latest, rep_min)
        and _misses(sessions[1], rep_min)
    ):
        return Suggestion(
            weight_kg=_round_to_step(weight * DELOAD_FACTOR, increment_kg),
            reps=rep_min,
            source="history",
            note=f"-10%: two sessions in a row below {rep_min} reps",
        )

    at_top = min(latest.reps) >= rep_max
    if at_top and _has_reserve(latest):
        if not weight:
            return Suggestion(
                weight_kg=weight,
                reps=rep_max,
                source="history",
                note="Top of the range: add a harder variation or load",
            )
        return Suggestion(
            weight_kg=round(weight + increment_kg, 2),
            reps=rep_min,
            source="history",
            note=f"+{_format_kg(increment_kg)} kg: every set reached {rep_max} reps",
        )
    if at_top:
        return Suggestion(
            weight_kg=weight,
            reps=rep_max,
            source="history",
            note="Same load: the last sets had no reps in reserve",
        )

    reps = min(max(min(latest.reps) + 1, rep_min), rep_max)
    return Suggestion(
        weight_kg=weight, reps=reps, source="history", note=f"Same load, aim for {reps} reps"
    )
