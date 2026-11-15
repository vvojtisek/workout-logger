"""Readiness check-ins: storing them, deriving yesterday's strain, and the
check-in that applies when a workout starts. Scoring is in readiness_score."""

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import ReadinessLog, WorkoutLog
from app.models.base import utcnow
from app.schemas.readiness import ReadinessLogCreate
from app.services.activity_kinds import is_training
from app.services.readiness_score import main_reason

# A check-in counts for a workout started within this many hours of it, so
# this morning's check-in applies without knowing the athlete's time zone.
SESSION_START_WINDOW = timedelta(hours=18)
HIGH_STRAIN_RPE = 8


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=UTC)
    return start, start + timedelta(days=1)


async def logs_on(session: AsyncSession, day: date) -> list[WorkoutLog]:
    start, end = _day_bounds(day)
    return list(
        (
            await session.scalars(
                select(WorkoutLog).where(
                    WorkoutLog.performed_at >= start, WorkoutLog.performed_at < end
                )
            )
        ).all()
    )


def strain_of(logs: list[WorkoutLog]) -> str:
    """Ice hockey or a session RPE of 8+ is high; any other training is
    moderate; recovery (sauna, meditation, stretching, cold plunge) is not training."""
    training = [log for log in logs if is_training(log.activity_type)]
    if any(
        log.activity_type == "ice_hockey" or (log.effort_rpe or 0) >= HIGH_STRAIN_RPE
        for log in training
    ):
        return "high"
    return "moderate" if training else "none"


async def hockey_on(session: AsyncSession, day: date) -> bool:
    return any(log.activity_type == "ice_hockey" for log in await logs_on(session, day))


async def derive_prior_day_strain(session: AsyncSession, log_date: date) -> str:
    return strain_of(await logs_on(session, log_date - timedelta(days=1)))


async def create_readiness_log(
    session: AsyncSession, data: ReadinessLogCreate, *, source: str = "app", commit: bool = True
) -> ReadinessLog:
    logged_at = data.logged_at or utcnow()
    log_date = data.log_date or logged_at.date()
    if data.prior_day_strain is None:
        strain = await derive_prior_day_strain(session, log_date)
        strain_source = "derived"
    else:
        strain = data.prior_day_strain
        strain_source = "manual"
    log = ReadinessLog(
        log_date=log_date,
        logged_at=logged_at,
        soreness=data.soreness,
        sore_muscle_groups=list(data.sore_muscle_groups),
        fatigue=data.fatigue,
        sleep_quality=data.sleep_quality,
        prior_day_strain=strain,
        strain_source=strain_source,
        physical_constraints=list(data.physical_constraints),
        notes=data.notes,
        source=source,
    )
    session.add(log)
    if commit:
        await session.commit()
    else:
        await session.flush()
    return log


async def list_readiness_logs(
    session: AsyncSession, start: date, end: date, limit: int = 60
) -> list[ReadinessLog]:
    return list(
        (
            await session.scalars(
                select(ReadinessLog)
                .where(ReadinessLog.log_date >= start, ReadinessLog.log_date <= end)
                .order_by(ReadinessLog.logged_at.desc())
                .limit(limit)
            )
        ).all()
    )


async def delete_readiness_log(session: AsyncSession, log_id: UUID) -> None:
    log = await session.scalar(select(ReadinessLog).where(ReadinessLog.id == log_id))
    if log is None:
        raise NotFoundError("Readiness log not found", code="READINESS_LOG_NOT_FOUND")
    await session.delete(log)
    await session.commit()


async def latest_for_session_start(
    session: AsyncSession, now: datetime | None = None
) -> ReadinessLog | None:
    moment = now or utcnow()
    return await session.scalar(
        select(ReadinessLog)
        .where(
            ReadinessLog.logged_at >= moment - SESSION_START_WINDOW,
            ReadinessLog.logged_at <= moment + timedelta(minutes=5),
        )
        .order_by(ReadinessLog.logged_at.desc())
        .limit(1)
    )


async def reason_for(session: AsyncSession, log: ReadinessLog) -> str:
    hockey = log.prior_day_strain == "high" and await hockey_on(
        session, log.log_date - timedelta(days=1)
    )
    return main_reason(log.inputs, hockey_yesterday=hockey)
