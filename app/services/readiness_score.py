"""Readiness score and load factor from a subjective check-in.

Each component present maps to 0..1 (1 = fully recovered) and is weighted;
absent components drop out and the remaining weights are renormalised:

- soreness 1-10 (10 = very sore): (10 - s) / 9, weight 0.30
- fatigue 1-10 (10 = exhausted): (10 - f) / 9, weight 0.30
- sleep quality 1-10 (10 = excellent): (q - 1) / 9, weight 0.25
- prior-day strain: none 1.0, moderate 0.7, high 0.4, weight 0.15

Score = round(100 x weighted mean). Load factor for history-based loads:
>= 75 -> 1.00, 60-74 -> 0.95, 45-59 -> 0.90, below 45 -> 0.85. A primary
muscle reported sore at 7 or more takes a further 0.05 off that exercise.

The thresholds are a conservative heuristic, not validated cut-offs: group
studies support self-reported wellness as a recovery signal, not these
numbers. RIR logged during the session remains the stronger signal.
"""

from dataclasses import dataclass

SORENESS_WEIGHT = 0.30
FATIGUE_WEIGHT = 0.30
SLEEP_WEIGHT = 0.25
STRAIN_WEIGHT = 0.15
STRAIN_VALUES = {"none": 1.0, "moderate": 0.7, "high": 0.4}
# (minimum score, load factor), checked from the top.
LOAD_FACTOR_BANDS = ((75, 1.0), (60, 0.95), (45, 0.9), (0, 0.85))
SORE_MUSCLE_THRESHOLD = 7
SORE_MUSCLE_EXTRA_CUT = 0.05


@dataclass(frozen=True)
class ReadinessInputs:
    soreness: int | None
    fatigue: int | None
    sleep_quality: int | None
    prior_day_strain: str
    sore_muscle_groups: tuple[str, ...] = ()


def readiness_score(inputs: ReadinessInputs) -> int:
    parts: list[tuple[float, float]] = []
    if inputs.soreness is not None:
        parts.append(((10 - inputs.soreness) / 9, SORENESS_WEIGHT))
    if inputs.fatigue is not None:
        parts.append(((10 - inputs.fatigue) / 9, FATIGUE_WEIGHT))
    if inputs.sleep_quality is not None:
        parts.append(((inputs.sleep_quality - 1) / 9, SLEEP_WEIGHT))
    parts.append((STRAIN_VALUES[inputs.prior_day_strain], STRAIN_WEIGHT))
    total_weight = sum(weight for _, weight in parts)
    value = sum(part * weight for part, weight in parts) / total_weight
    return round(100 * value)


def load_factor(score: int) -> float:
    for minimum, factor in LOAD_FACTOR_BANDS:
        if score >= minimum:
            return factor
    return LOAD_FACTOR_BANDS[-1][1]


def main_reason(inputs: ReadinessInputs, *, hockey_yesterday: bool) -> str:
    """The plain-language cause of a cut, for the HUD badge."""
    if inputs.prior_day_strain == "high":
        return "post-hockey recovery" if hockey_yesterday else "yesterday's hard session"
    candidates: list[tuple[float, str]] = []
    if inputs.soreness is not None:
        candidates.append(((10 - inputs.soreness) / 9, "soreness"))
    if inputs.fatigue is not None:
        candidates.append(((10 - inputs.fatigue) / 9, "fatigue"))
    if inputs.sleep_quality is not None:
        candidates.append(((inputs.sleep_quality - 1) / 9, "poor sleep"))
    if inputs.prior_day_strain == "moderate":
        candidates.append((STRAIN_VALUES["moderate"], "yesterday's training"))
    if not candidates:
        return "today's check-in"
    return min(candidates)[1]


def exercise_factor(inputs: ReadinessInputs, primary_muscles: set[str]) -> float:
    factor = load_factor(readiness_score(inputs))
    if (
        inputs.soreness is not None
        and inputs.soreness >= SORE_MUSCLE_THRESHOLD
        and primary_muscles & set(inputs.sore_muscle_groups)
    ):
        factor -= SORE_MUSCLE_EXTRA_CUT
    return round(factor, 2)
