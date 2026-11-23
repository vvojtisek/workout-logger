from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import ConflictError
from app.models import CoachingContext
from app.models.base import utcnow
from app.schemas.coaching_context import (
    CoachingContextNotesUpdate,
    CoachingContextProfileUpdate,
    CoachingContextRead,
    CoachingContextTarget,
)

_SINGLETON_KEY = "default"


async def _find_singleton(session: AsyncSession) -> CoachingContext | None:
    result = await session.execute(
        select(CoachingContext).where(CoachingContext.singleton_key == _SINGLETON_KEY)
    )
    return result.scalar_one_or_none()


async def get_existing_coaching_context(session: AsyncSession) -> CoachingContext | None:
    """Non-mutating read: returns None if the singleton row has not been created yet."""
    return await _find_singleton(session)


async def get_coaching_context(session: AsyncSession) -> CoachingContext:
    record = await _find_singleton(session)
    if record is not None:
        return record

    record = CoachingContext(singleton_key=_SINGLETON_KEY)
    session.add(record)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await _find_singleton(session)
        if existing is not None:
            return existing
        raise
    await session.refresh(record)
    return record


async def update_profile(
    session: AsyncSession, data: CoachingContextProfileUpdate
) -> CoachingContext:
    record = await get_coaching_context(session)
    if record.profile_version != data.expected_profile_version:
        raise ConflictError(
            "Coaching profile version mismatch; fetch the latest context and retry",
            code="STALE_RECORD",
            current_record=CoachingContextRead.model_validate(record).model_dump(mode="json"),
        )

    record.previous_profile_md = record.athlete_profile_md
    record.athlete_profile_md = data.athlete_profile_md
    record.profile_version += 1
    record.updated_at = utcnow()
    await session.commit()
    await session.refresh(record)
    return record


async def update_notes(session: AsyncSession, data: CoachingContextNotesUpdate) -> CoachingContext:
    record = await get_coaching_context(session)
    if record.notes_version != data.expected_notes_version:
        raise ConflictError(
            "Coaching working notes version mismatch; fetch the latest context and retry",
            code="STALE_RECORD",
            current_record=CoachingContextRead.model_validate(record).model_dump(mode="json"),
        )

    record.previous_notes_md = record.working_notes_md
    record.working_notes_md = data.working_notes_md
    record.notes_version += 1
    record.updated_at = utcnow()
    await session.commit()
    await session.refresh(record)
    return record


async def revert_context(session: AsyncSession, target: CoachingContextTarget) -> CoachingContext:
    record = await get_coaching_context(session)
    if target == "profile":
        if record.previous_profile_md is None:
            raise ConflictError(
                "No previous coaching profile snapshot is available to revert",
                code="NO_PREVIOUS_VERSION",
                current_record=CoachingContextRead.model_validate(record).model_dump(mode="json"),
            )
        record.athlete_profile_md = record.previous_profile_md
        record.previous_profile_md = None
        record.profile_version += 1
    else:
        if record.previous_notes_md is None:
            raise ConflictError(
                "No previous coaching working notes snapshot is available to revert",
                code="NO_PREVIOUS_VERSION",
                current_record=CoachingContextRead.model_validate(record).model_dump(mode="json"),
            )
        record.working_notes_md = record.previous_notes_md
        record.previous_notes_md = None
        record.notes_version += 1

    record.updated_at = utcnow()
    await session.commit()
    await session.refresh(record)
    return record
