"""What kind of session a workout log records, and how the 1-5 effort level
relates to the CR-10 session RPE that training load is built on.

A log with no activity_type is a strength workout. Every other type is either
cardio/sport or recovery; recovery sessions (sauna, meditation, stretching,
cold plunge) are not training and add no training load.
"""

from datetime import date
from typing import Literal

ActivityCategory = Literal["strength", "cardio", "recovery"]
Season = Literal["winter", "summer"]

CARDIO_TYPES: tuple[str, ...] = (
    "ice_hockey",
    "swimming",
    "cycling",
    "hiking",
    "running",
    "other",
)
RECOVERY_TYPES: tuple[str, ...] = ("sauna", "meditation", "stretching", "cold_plunge")
# Stored order: the original seven, then the recovery types added later.
ALL_ACTIVITY_TYPES: tuple[str, ...] = (
    "ice_hockey",
    "swimming",
    "sauna",
    "cycling",
    "hiking",
    "running",
    "other",
    "meditation",
    "stretching",
    "cold_plunge",
)

# Effort level 1 (recovery, relaxed) .. 5 (max effort) onto session RPE (CR-10):
# 1 easy, 3 moderate tempo ~ "hard" on CR-10, 5 near maximal.
_LEVEL_TO_RPE = {1: 2, 2: 3, 3: 5, 4: 7, 5: 9}

# Winter is the ice season (October to April); summer is May to September.
WINTER_MONTHS = frozenset({10, 11, 12, 1, 2, 3, 4})
SEASON_PRIORITY: dict[Season, tuple[str, ...]] = {
    "winter": ("ice_hockey", "swimming"),
    "summer": ("cycling", "hiking", "swimming"),
}


def category_of(activity_type: str | None) -> ActivityCategory:
    if activity_type is None:
        return "strength"
    if activity_type in RECOVERY_TYPES:
        return "recovery"
    return "cardio"


def is_training(activity_type: str | None) -> bool:
    """Strength and cardio count as training; recovery sessions do not."""
    return category_of(activity_type) != "recovery"


def level_to_rpe(level: int) -> int:
    return _LEVEL_TO_RPE[level]


def rpe_to_level(rpe: int) -> int:
    """The nearest effort level for a CR-10 RPE (older logs carry only RPE)."""
    if rpe <= 2:
        return 1
    if rpe <= 3:
        return 2
    if rpe <= 5:
        return 3
    if rpe <= 7:
        return 4
    return 5


def season_of(day: date) -> Season:
    return "winter" if day.month in WINTER_MONTHS else "summer"
