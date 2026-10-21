"""Training volume: the one place that turns logged weight and reps into kg moved.

The weight a user types is always what one hand holds: one dumbbell, or the
whole bar or machine stack. How that turns into volume depends on the exercise
definition, read at calculation time, so changing an exercise changes the
volume of every session already logged with it:

- `equipment_load_mode` "pair_db": two dumbbells move on every rep (DB bench
  press, DB lunges), so the load counts twice. "single_db" and "standard" count
  the typed weight once.
- `is_unilateral`: one logged set is the same reps done on each side (Bulgarian
  split squat, single-arm row, alternating curls), so reps and volume count
  twice.

Pure functions only; `app.services.volume_rules` looks the rules up for logs
and sessions. The progression engine never calls this: it works on the typed
per-dumbbell weight, which stays unchanged.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

LoadMode = Literal["standard", "single_db", "pair_db"]
LOAD_MODES: tuple[LoadMode, ...] = ("standard", "single_db", "pair_db")


@dataclass(frozen=True)
class VolumeRule:
    equipment_load_mode: LoadMode = "standard"
    is_unilateral: bool = False

    @property
    def weight_multiplier(self) -> int:
        return 2 if self.equipment_load_mode == "pair_db" else 1

    @property
    def side_multiplier(self) -> int:
        return 2 if self.is_unilateral else 1


DEFAULT_RULE = VolumeRule()


def total_reps(reps: int, rule: VolumeRule = DEFAULT_RULE) -> int:
    """Reps across both sides for one logged set."""
    return reps * rule.side_multiplier


def set_volume_kg(weight_kg: float | None, reps: int, rule: VolumeRule = DEFAULT_RULE) -> float:
    """Volume of one logged set: weight x reps x dumbbells moved x sides."""
    if not weight_kg:
        return 0.0
    return weight_kg * rule.weight_multiplier * reps * rule.side_multiplier


def sets_volume_kg(
    sets: Iterable[tuple[float | None, int]], rule: VolumeRule = DEFAULT_RULE
) -> float:
    """Volume of several (weight_kg, reps) sets of the same exercise, rounded to 0.1 kg."""
    return round(sum(set_volume_kg(weight, reps, rule) for weight, reps in sets), 1)
