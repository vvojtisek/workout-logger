"""One write for "how I feel" and/or "what I did": the phone's one-tap
buttons, the MCP tool log_readiness_and_activity and POST /coach/log all go
through here, so the defaults live in one place."""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import WorkoutLog
from app.models.base import utcnow
from app.schemas.coach import CoachActivityIn, CoachLogRequest, CoachLogResult
from app.schemas.logs import WorkoutLogRead
from app.schemas.readiness import ReadinessLogRead
from app.services.activity_kinds import RECOVERY_TYPES, category_of, level_to_rpe
from app.services.health_connect import SOURCE as HEALTH_CONNECT
from app.services.logs import check_linked_log, get_log
from app.services.readiness import create_readiness_log

# A watch session of the same kind starting this close to a hand-logged one
# is the same session.
MERGE_WINDOW = timedelta(hours=3)
# A recovery entry this soon after a training session is taken as following it.
LINK_WINDOW = timedelta(hours=6)


@dataclass(frozen=True)
class ActivityDefaults:
    activity_type: str | None
    name: str
    minutes: int
    rpe: int | None
    laps: int | None = None
    sauna_rounds: int | None = None


ACTIVITY_DEFAULTS: dict[str, ActivityDefaults] = {
    "ice_hockey": ActivityDefaults("ice_hockey", "Ice hockey", 75, 8),
    "swimming": ActivityDefaults("swimming", "Swim", 30, 5, laps=30),
    "swim_sauna": ActivityDefaults("swimming", "Swim + sauna", 30, 5, laps=30, sauna_rounds=3),
    "sauna": ActivityDefaults("sauna", "Sauna", 45, None, sauna_rounds=3),
    "meditation": ActivityDefaults("meditation", "Meditation", 15, None),
    "stretching": ActivityDefaults("stretching", "Stretching", 15, None),
    "cold_plunge": ActivityDefaults("cold_plunge", "Cold plunge", 5, None),
    "gym": ActivityDefaults(None, "Gym session", 45, 7),
    "cycling": ActivityDefaults("cycling", "Ride", 60, 5),
    "hiking": ActivityDefaults("hiking", "Hike", 120, 4),
    "running": ActivityDefaults("running", "Run", 30, 6),
    "other": ActivityDefaults("other", "Activity", 30, None),
}
DEFAULT_FEELING = 4


def _effort_rpe(activity: CoachActivityIn, defaults: ActivityDefaults) -> int | None:
    if activity.effort_rpe is not None:
        return activity.effort_rpe
    if activity.effort_level is not None and category_of(defaults.activity_type) != "recovery":
        return level_to_rpe(activity.effort_level)
    return defaults.rpe


def _workout_log(activity: CoachActivityIn) -> WorkoutLog:
    defaults = ACTIVITY_DEFAULTS[activity.type]
    is_sauna = defaults.activity_type == "sauna"
    sauna_rounds = (
        activity.sauna_rounds
        if activity.sauna_rounds is not None
        else activity.cycles
        if is_sauna and activity.cycles is not None
        else defaults.sauna_rounds
    )
    cycles = activity.cycles
    if cycles is None and is_sauna and sauna_rounds:
        cycles = sauna_rounds
    minutes = activity.duration_minutes
    if minutes is None and cycles and activity.cycle_minutes:
        minutes = min(cycles * activity.cycle_minutes, 600)
    return WorkoutLog(
        source_plan_name=defaults.name,
        performed_at=activity.performed_at or utcnow(),
        total_time_minutes=minutes or defaults.minutes,
        overall_feeling=activity.overall_feeling or activity.feel_after or DEFAULT_FEELING,
        notes=activity.notes,
        activity_type=defaults.activity_type,
        activity_name=(activity.activity_name or "").strip() or None,
        distance_km=activity.distance_km,
        effort_rpe=_effort_rpe(activity, defaults),
        effort_level=activity.effort_level,
        feel_before=activity.feel_before,
        feel_after=activity.feel_after,
        laps=activity.laps if activity.laps is not None else defaults.laps,
        sauna_rounds=sauna_rounds,
        cycles=cycles,
        cycle_minutes=activity.cycle_minutes,
        linked_log_id=activity.linked_log_id,
    )


async def _watch_session_to_fill(session: AsyncSession, log: WorkoutLog) -> WorkoutLog | None:
    """A Health Connect session of the same kind near this one that nobody has
    rated yet. The watch measured it; the person is now adding how it felt."""
    if log.activity_type is None or log.activity_type in RECOVERY_TYPES:
        return None
    return await session.scalar(
        select(WorkoutLog)
        .where(
            WorkoutLog.source == HEALTH_CONNECT,
            WorkoutLog.activity_type == log.activity_type,
            WorkoutLog.effort_level.is_(None),
            WorkoutLog.performed_at >= log.performed_at - MERGE_WINDOW,
            WorkoutLog.performed_at <= log.performed_at + MERGE_WINDOW,
        )
        .order_by(WorkoutLog.performed_at)
        .limit(1)
    )


def _fill_rated_fields(target: WorkoutLog, rated: WorkoutLog, activity: CoachActivityIn) -> None:
    """Measured values (start, duration, distance) stay the watch's; what the
    person rated or wrote is added."""
    target.effort_level = rated.effort_level
    if activity.effort_rpe is not None or rated.effort_level is not None:
        target.effort_rpe = rated.effort_rpe
    target.feel_before = rated.feel_before
    target.feel_after = rated.feel_after
    target.overall_feeling = rated.overall_feeling
    if rated.notes:
        target.notes = f"{target.notes}\n{rated.notes}" if target.notes else rated.notes
    if rated.activity_name:
        target.activity_name = rated.activity_name
    if target.distance_km is None:
        target.distance_km = rated.distance_km
    if rated.laps is not None and activity.laps is not None:
        target.laps = rated.laps


async def _previous_training(session: AsyncSession, log: WorkoutLog) -> WorkoutLog | None:
    return await session.scalar(
        select(WorkoutLog)
        .where(
            WorkoutLog.performed_at >= log.performed_at - LINK_WINDOW,
            WorkoutLog.performed_at <= log.performed_at,
            WorkoutLog.activity_type.is_(None) | WorkoutLog.activity_type.not_in(RECOVERY_TYPES),
        )
        .order_by(WorkoutLog.performed_at.desc())
        .limit(1)
    )


async def _save_activity(
    session: AsyncSession, activity: CoachActivityIn
) -> tuple[WorkoutLog, bool]:
    log = _workout_log(activity)
    await check_linked_log(session, log.linked_log_id)
    existing = await _watch_session_to_fill(session, log)
    if existing is not None:
        _fill_rated_fields(existing, log, activity)
        await session.flush()
        return existing, True
    if (
        log.linked_log_id is None
        and activity.link_to_previous
        and log.activity_type in RECOVERY_TYPES
    ):
        previous = await _previous_training(session, log)
        if previous is not None:
            log.linked_log_id = previous.id
    session.add(log)
    await session.flush()
    return log, False


async def log_readiness_and_activity(
    session: AsyncSession, data: CoachLogRequest, *, source: str
) -> CoachLogResult:
    """Both records commit together or not at all. The activity is written
    first so a check-in in the same call sees it only as today's, not
    yesterday's, training."""
    workout_log = None
    merged = False
    if data.activity is not None:
        workout_log, merged = await _save_activity(session, data.activity)
    readiness_log = None
    if data.readiness is not None:
        readiness_log = await create_readiness_log(
            session, data.readiness, source=source, commit=False
        )
    await session.commit()
    return CoachLogResult(
        readiness_log=(
            ReadinessLogRead.model_validate(readiness_log) if readiness_log is not None else None
        ),
        workout_log=(
            WorkoutLogRead.model_validate(await get_log(session, workout_log.id))
            if workout_log is not None
            else None
        ),
        merged_into_existing=merged,
    )
