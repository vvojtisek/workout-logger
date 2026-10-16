from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CoachingPrinciples
from app.schemas.coaching_principles import CoachingPrinciplesRead, CoachingPrinciplesUpdate


async def _row(session: AsyncSession) -> CoachingPrinciples | None:
    result = await session.execute(select(CoachingPrinciples).limit(1))
    return result.scalar_one_or_none()


async def get_principles(session: AsyncSession) -> CoachingPrinciplesRead:
    """Reads never write: before the first save the principles are empty."""
    row = await _row(session)
    if row is None:
        return CoachingPrinciplesRead(body="", updated_at=None)
    return CoachingPrinciplesRead(body=row.body, updated_at=row.updated_at)


async def replace_principles(
    session: AsyncSession, data: CoachingPrinciplesUpdate
) -> CoachingPrinciplesRead:
    row = await _row(session)
    if row is None:
        row = CoachingPrinciples(body=data.body)
        session.add(row)
    else:
        row.body = data.body
    await session.commit()
    await session.refresh(row)
    return CoachingPrinciplesRead(body=row.body, updated_at=row.updated_at)
