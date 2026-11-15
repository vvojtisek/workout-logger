"""The supplement protocol: replacing the active stack, which entries are
due on a date, and ticking them off."""

from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import NotFoundError
from app.models import ScheduledWorkout, SupplementIntake, SupplementSchedule
from app.models.base import utcnow
from app.schemas.meal_plans import (
    SupplementDue,
    SupplementIn,
    SupplementRead,
    SupplementsDue,
)
from app.services.load_events import get_occurrences
from app.services.readiness import logs_on

TIMING_ORDER = ("morning", "pre_workout", "with_meal", "post_workout", "evening", "bedtime")


def _sort_key(item: SupplementSchedule) -> tuple[int, str]:
    return (TIMING_ORDER.index(item.timing), item.name.lower())


async def list_active(session: AsyncSession) -> list[SupplementSchedule]:
    rows = (
        await session.scalars(select(SupplementSchedule).where(SupplementSchedule.active.is_(True)))
    ).all()
    return sorted(rows, key=_sort_key)


async def replace_stack(session: AsyncSession, stack: list[SupplementIn]) -> None:
    """Upserts by (name, timing); anything else active becomes inactive.
    Flushes only: the caller owns the transaction."""
    existing = list((await session.scalars(select(SupplementSchedule))).all())
    by_key = {(row.name.lower(), row.timing): row for row in existing}
    wanted: set[tuple[str, str]] = set()
    item_key: tuple[str, str]
    for item in stack:
        item_key = (item.name.lower(), item.timing)
        wanted.add(item_key)
        row = by_key.get(item_key)
        if row is None:
            row = SupplementSchedule(name=item.name, timing=item.timing)
            session.add(row)
        row.name = item.name
        row.dose = item.dose
        row.unit = item.unit
        row.applies_on = item.applies_on
        row.notes = item.notes
        row.active = True
    for key, row in by_key.items():
        if key not in wanted:
            row.active = False
    await session.flush()


async def day_kind(session: AsyncSession, day: date) -> tuple[bool, bool]:
    """(training day, hockey day). Training = a scheduled workout that is not
    skipped, or any logged training; hockey = a hockey event or log."""
    hockey_events = [item for item in await get_occurrences(session, day, day) if item.date == day]
    logs = [log for log in await logs_on(session, day) if log.activity_type != "sauna"]
    scheduled = (
        await session.scalars(
            select(ScheduledWorkout.id).where(
                ScheduledWorkout.scheduled_date == day, ScheduledWorkout.status != "skipped"
            )
        )
    ).first()
    hockey = bool(hockey_events) or any(log.activity_type == "ice_hockey" for log in logs)
    training = hockey or bool(logs) or scheduled is not None
    return training, hockey


def _applies(item: SupplementSchedule, training: bool, hockey: bool) -> bool:
    if item.applies_on == "daily":
        return True
    if item.applies_on == "training_days":
        return training
    if item.applies_on == "rest_days":
        return not training
    return hockey


async def due_on(session: AsyncSession, day: date) -> SupplementsDue:
    training, hockey = await day_kind(session, day)
    rows = (
        await session.scalars(
            select(SupplementSchedule)
            .options(selectinload(SupplementSchedule.intakes))
            .where(SupplementSchedule.active.is_(True))
        )
    ).all()
    items = []
    for row in sorted(rows, key=_sort_key):
        if not _applies(row, training, hockey):
            continue
        intake = next((i for i in row.intakes if i.intake_date == day), None)
        items.append(
            SupplementDue(
                supplement=SupplementRead.model_validate(row),
                taken=intake is not None,
                taken_at=intake.taken_at if intake else None,
            )
        )
    return SupplementsDue(date=day, training_day=training, hockey_day=hockey, items=items)


async def _schedule(session: AsyncSession, schedule_id: UUID) -> SupplementSchedule:
    row = await session.scalar(
        select(SupplementSchedule)
        .options(selectinload(SupplementSchedule.intakes))
        .where(SupplementSchedule.id == schedule_id)
    )
    if row is None:
        raise NotFoundError("Supplement not found", code="SUPPLEMENT_NOT_FOUND")
    return row


async def mark_taken(session: AsyncSession, schedule_id: UUID, day: date) -> SupplementsDue:
    row = await _schedule(session, schedule_id)
    if not any(intake.intake_date == day for intake in row.intakes):
        row.intakes.append(SupplementIntake(intake_date=day, taken_at=utcnow()))
        await session.commit()
    return await due_on(session, day)


async def unmark_taken(session: AsyncSession, schedule_id: UUID, day: date) -> SupplementsDue:
    row = await _schedule(session, schedule_id)
    for intake in list(row.intakes):
        if intake.intake_date == day:
            row.intakes.remove(intake)
    await session.commit()
    return await due_on(session, day)
