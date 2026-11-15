"""Predicts what a cardio or recovery log will most likely say, from the last
few weeks of the athlete's own entries, so the quick-log form opens filled in.

Entries are matched by local weekday first (Tuesday's swim predicts next
Tuesday's), then by any day in the window, then fall back to per-type
defaults. Each field is the most frequent value in the matching entries, the
most recent one winning a tie, so a steady routine is reproduced exactly.
Entries from the other season count half, and the season's own activities
rank first when there is little history. Nothing here writes.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import TypeVar
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import WorkoutLog
from app.schemas.activity_defaults import (
    ActivityDefaultsResponse,
    ActivityTypeDefaults,
    LinkCandidate,
    PrefillBasis,
    PrefillCategory,
    RecoveryPreset,
)
from app.services.activity_kinds import (
    RECOVERY_TYPES,
    SEASON_PRIORITY,
    Season,
    category_of,
    rpe_to_level,
    season_of,
)

T = TypeVar("T")

SLOT_MINUTES = 15
MAX_TIME_SLOTS = 4
MAX_PRESETS = 4
SAME_WEEKDAY_WEIGHT = 3.0
SEASON_BONUS = 2.0
OTHER_SEASON_WEIGHT = 0.5

# Order shown when nothing else separates two types.
BASE_ORDER: dict[PrefillCategory, tuple[str, ...]] = {
    "cardio": ("ice_hockey", "swimming", "cycling", "hiking", "running", "other"),
    "recovery": ("sauna", "stretching", "meditation", "cold_plunge"),
}
DEFAULT_MINUTES = {
    "ice_hockey": 75,
    "swimming": 30,
    "cycling": 60,
    "hiking": 120,
    "running": 30,
    "other": 30,
    "sauna": 45,
    "meditation": 15,
    "stretching": 15,
    "cold_plunge": 5,
}
DEFAULT_CYCLES = {"sauna": 3}
# Minutes per sauna round when an entry only gave rounds (cooling included).
SAUNA_ROUND_MINUTES = 15
LABELS = {
    "sauna": "Sauna",
    "meditation": "Meditation",
    "stretching": "Stretching",
    "cold_plunge": "Cold plunge",
}
STARTER_PRESETS: tuple[tuple[str, int | None, int], ...] = (
    ("sauna", 3, 45),
    ("sauna", 2, 30),
    ("meditation", None, 15),
    ("stretching", None, 15),
    ("cold_plunge", None, 5),
)


def default_effort(activity_type: str, season: Season) -> int | None:
    """Effort before any history: an easy winter swim, a hard hockey game."""
    if activity_type in RECOVERY_TYPES:
        return None
    if activity_type == "swimming":
        return 2 if season == "winter" else 3
    return {"ice_hockey": 4, "hiking": 2}.get(activity_type, 3)


@dataclass(frozen=True)
class Observation:
    activity_type: str
    activity_name: str | None
    local_start: datetime
    duration: int | None
    effort_level: int | None
    cycles: int | None
    cycle_minutes: int | None
    weight: float

    @property
    def weekday(self) -> int:
        return self.local_start.weekday()

    @property
    def slot(self) -> str:
        minutes = self.local_start.hour * 60 + self.local_start.minute
        rounded = round(minutes / SLOT_MINUTES) * SLOT_MINUTES % (24 * 60)
        return f"{rounded // 60:02d}:{rounded % 60:02d}"


def _local_bounds(day: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
    return start, end


def _observations(
    logs: list[WorkoutLog], category: PrefillCategory, zone: ZoneInfo, season: Season
) -> list[Observation]:
    found: list[Observation] = []
    for log in logs:
        local = log.performed_at.astimezone(zone)
        weight = 1.0 if season_of(local.date()) == season else OTHER_SEASON_WEIGHT
        kind = category_of(log.activity_type)
        if category == "recovery" and kind != "recovery" and log.sauna_rounds:
            # A swim saved with its sauna rounds (the one-tap "Swim + sauna")
            # is also a sauna right after it.
            found.append(
                Observation(
                    activity_type="sauna",
                    activity_name=None,
                    local_start=local + timedelta(minutes=log.total_time_minutes),
                    duration=None,
                    effort_level=None,
                    cycles=log.sauna_rounds if 1 <= log.sauna_rounds <= 20 else None,
                    cycle_minutes=None,
                    weight=weight,
                )
            )
            continue
        if kind != category or log.activity_type is None:
            continue
        level = log.effort_level
        if level is None and log.effort_rpe is not None and kind == "cardio":
            level = rpe_to_level(log.effort_rpe)
        found.append(
            Observation(
                activity_type=log.activity_type,
                activity_name=log.activity_name,
                local_start=local,
                duration=log.total_time_minutes,
                effort_level=level,
                cycles=log.cycles,
                cycle_minutes=log.cycle_minutes,
                weight=weight,
            )
        )
    found.sort(key=lambda item: item.local_start)
    return found


def _mode(values: list[tuple[T | None, float]]) -> T | None:
    """Most frequent non-null value by weight; the latest wins a tie. `values`
    is oldest first."""
    weights: dict[T, float] = {}
    latest: dict[T, int] = {}
    for index, (value, weight) in enumerate(values):
        if value is None:
            continue
        weights[value] = weights.get(value, 0.0) + weight
        latest[value] = index
    if not weights:
        return None
    return max(weights, key=lambda value: (weights[value], latest[value]))


def _started_at(day: date, slot: str | None, zone: ZoneInfo) -> datetime | None:
    if slot is None:
        return None
    hour, minute = (int(part) for part in slot.split(":"))
    return datetime.combine(day, time(hour, minute), tzinfo=zone).astimezone(UTC)


def _type_defaults(
    activity_type: str,
    observations: list[Observation],
    weekday: int,
    day: date,
    season: Season,
    zone: ZoneInfo,
) -> ActivityTypeDefaults:
    of_type = [item for item in observations if item.activity_type == activity_type]
    same_day = [item for item in of_type if item.weekday == weekday]
    pool = same_day or of_type
    basis: PrefillBasis = "same_weekday" if same_day else "recent" if of_type else "default"

    def pick(attribute: str):
        return _mode([(getattr(item, attribute), item.weight) for item in pool])

    cycles = pick("cycles") or DEFAULT_CYCLES.get(activity_type)
    cycle_minutes = pick("cycle_minutes")
    duration = pick("duration")
    if duration is None:
        duration = (
            cycles * cycle_minutes
            if cycles and cycle_minutes
            else cycles * SAUNA_ROUND_MINUTES
            if activity_type == "sauna" and cycles and pool
            else DEFAULT_MINUTES[activity_type]
        )
    effort = pick("effort_level")
    if effort is None:
        effort = default_effort(activity_type, season)
    slot = pick("slot")
    return ActivityTypeDefaults(
        activity_type=activity_type,  # type: ignore[arg-type]
        activity_name=pick("activity_name") if activity_type == "other" else None,
        start_time=slot,
        started_at=_started_at(day, slot, zone),
        duration_minutes=duration,
        effort_level=effort,
        cycles=cycles,
        cycle_minutes=cycle_minutes,
        observations=len(of_type),
        same_weekday_observations=len(same_day),
        basis=basis,
    )


def _ranked(
    category: PrefillCategory,
    observations: list[Observation],
    weekday: int,
    season: Season,
) -> list[str]:
    base = BASE_ORDER[category]
    priority = SEASON_PRIORITY[season]
    score: dict[str, float] = dict.fromkeys(base, 0.0)
    for item in observations:
        bonus = SAME_WEEKDAY_WEIGHT if item.weekday == weekday else 1.0
        score[item.activity_type] = score.get(item.activity_type, 0.0) + bonus * item.weight
    for kind in priority:
        if kind in score:
            score[kind] += SEASON_BONUS

    def order(kind: str) -> tuple[float, int, int]:
        seasonal = priority.index(kind) if kind in priority else len(priority)
        return (-score[kind], seasonal, base.index(kind))

    return sorted(base, key=order)


def _time_slots(observations: list[Observation], weekday: int) -> list[str]:
    same_day = [item for item in observations if item.weekday == weekday]
    counts = Counter(item.slot for item in same_day)
    latest = {item.slot: index for index, item in enumerate(same_day)}
    ordered = sorted(counts, key=lambda slot: (-counts[slot], -latest[slot]))
    return ordered[:MAX_TIME_SLOTS]


def _preset_label(activity_type: str, cycles: int | None, duration: int) -> str:
    name = LABELS.get(activity_type, activity_type)
    if cycles:
        return f"{name} · {cycles} {'cycle' if cycles == 1 else 'cycles'}"
    return f"{name} · {duration} min"


def _presets(observations: list[Observation]) -> list[RecoveryPreset]:
    keyed: Counter[tuple[str, int | None, int | None, int]] = Counter()
    latest: dict[tuple[str, int | None, int | None, int], int] = {}
    for index, item in enumerate(observations):
        duration = item.duration
        if duration is None:
            duration = (item.cycles or DEFAULT_CYCLES.get(item.activity_type, 1)) * (
                item.cycle_minutes or SAUNA_ROUND_MINUTES
            )
        key = (item.activity_type, item.cycles, item.cycle_minutes, duration)
        keyed[key] += 1
        latest[key] = index
    ordered = sorted(keyed, key=lambda key: (-keyed[key], -latest[key]))
    presets = [
        RecoveryPreset(
            label=_preset_label(kind, cycles, duration),
            activity_type=kind,  # type: ignore[arg-type]
            duration_minutes=duration,
            cycles=cycles,
            cycle_minutes=cycle_minutes,
            times_logged=keyed[(kind, cycles, cycle_minutes, duration)],
        )
        for kind, cycles, cycle_minutes, duration in ordered
    ][:MAX_PRESETS]
    # Fill the row with common starters the history does not already cover.
    seen: set[tuple[str, int | None]] = {
        (preset.activity_type, preset.cycles) for preset in presets
    }
    for kind, cycles, duration in STARTER_PRESETS:
        if len(presets) >= MAX_PRESETS:
            break
        if (kind, cycles) in seen or (cycles is None and any(k == kind for k, _ in seen)):
            continue
        seen.add((kind, cycles))
        presets.append(
            RecoveryPreset(
                label=_preset_label(kind, cycles, duration),
                activity_type=kind,  # type: ignore[arg-type]
                duration_minutes=duration,
                cycles=cycles,
                cycle_minutes=None,
                times_logged=0,
            )
        )
    return presets


async def predict_defaults(
    session: AsyncSession,
    *,
    day: date,
    category: PrefillCategory,
    tz_name: str,
    weeks: int = 8,
) -> ActivityDefaultsResponse:
    zone = ZoneInfo(tz_name)
    season = season_of(day)
    weekday = day.weekday()
    day_start, day_end = _local_bounds(day, zone)
    window_start, _ = _local_bounds(day - timedelta(weeks=weeks), zone)

    history = list(
        (
            await session.scalars(
                select(WorkoutLog)
                .where(
                    WorkoutLog.performed_at >= window_start,
                    WorkoutLog.performed_at < day_start,
                    WorkoutLog.activity_type.is_not(None) | WorkoutLog.sauna_rounds.is_not(None),
                )
                .order_by(WorkoutLog.performed_at)
            )
        ).all()
    )
    observations = _observations(history, category, zone, season)
    ranked = [
        _type_defaults(kind, observations, weekday, day, season, zone)
        for kind in _ranked(category, observations, weekday, season)
    ]

    presets: list[RecoveryPreset] = []
    link_candidates: list[LinkCandidate] = []
    if category == "recovery":
        presets = _presets(observations)
        same_day = (
            await session.scalars(
                select(WorkoutLog)
                .where(WorkoutLog.performed_at >= day_start, WorkoutLog.performed_at < day_end)
                .order_by(WorkoutLog.performed_at)
            )
        ).all()
        link_candidates = [
            LinkCandidate(
                id=log.id,
                activity_type=log.activity_type,  # type: ignore[arg-type]
                name=log.activity_name or log.source_plan_name,
                performed_at=log.performed_at,
            )
            for log in same_day
            if category_of(log.activity_type) != "recovery"
        ]

    return ActivityDefaultsResponse(
        date=day,
        day_of_week=weekday,
        season=season,
        category=category,
        timezone=tz_name,
        weeks=weeks,
        history_entries=len(observations),
        suggested=ranked[0],
        ranked=ranked,
        time_slots=_time_slots(observations, weekday),
        presets=presets,
        link_candidates=link_candidates,
    )
