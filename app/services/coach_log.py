"""One write for "how I feel" and/or "what I did": the phone's one-tap
buttons, the MCP tool log_readiness_and_activity and POST /coach/log all go
through here, so the defaults live in one place."""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import WorkoutLog
from app.models.base import utcnow
from app.schemas.coach import CoachActivityIn, CoachLogRequest, CoachLogResult
from app.schemas.logs import WorkoutLogRead
from app.schemas.readiness import ReadinessLogRead
from app.services.logs import get_log
from app.services.readiness import create_readiness_log


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
    "gym": ActivityDefaults(None, "Gym session", 45, 7),
    "cycling": ActivityDefaults("cycling", "Ride", 60, 5),
    "hiking": ActivityDefaults("hiking", "Hike", 120, 4),
    "running": ActivityDefaults("running", "Run", 30, 6),
    "other": ActivityDefaults("other", "Activity", 30, None),
}
DEFAULT_FEELING = 4


def _workout_log(activity: CoachActivityIn) -> WorkoutLog:
    defaults = ACTIVITY_DEFAULTS[activity.type]
    return WorkoutLog(
        source_plan_name=defaults.name,
        performed_at=activity.performed_at or utcnow(),
        total_time_minutes=activity.duration_minutes or defaults.minutes,
        overall_feeling=activity.overall_feeling or DEFAULT_FEELING,
        notes=activity.notes,
        activity_type=defaults.activity_type,
        distance_km=activity.distance_km,
        effort_rpe=activity.effort_rpe if activity.effort_rpe is not None else defaults.rpe,
        laps=activity.laps if activity.laps is not None else defaults.laps,
        sauna_rounds=(
            activity.sauna_rounds if activity.sauna_rounds is not None else defaults.sauna_rounds
        ),
    )


async def log_readiness_and_activity(
    session: AsyncSession, data: CoachLogRequest, *, source: str
) -> CoachLogResult:
    """Both records commit together or not at all. The activity is written
    first so a check-in in the same call sees it only as today's, not
    yesterday's, training."""
    workout_log = None
    if data.activity is not None:
        workout_log = _workout_log(data.activity)
        session.add(workout_log)
        await session.flush()
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
    )
