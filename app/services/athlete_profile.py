import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AthleteProfile
from app.schemas.athlete_profile import AthleteProfileRead, AthleteProfileReplace


async def _row(session: AsyncSession) -> AthleteProfile | None:
    # Reads are owner-scoped by app/database.py, so this is the caller's row.
    return await session.scalar(select(AthleteProfile).order_by(AthleteProfile.created_at).limit(1))


async def get_profile(session: AsyncSession) -> AthleteProfileRead:
    row = await _row(session)
    if row is None:
        return AthleteProfileRead()
    return AthleteProfileRead.model_validate(
        {
            "display_name": row.display_name,
            "birth_year": row.birth_year,
            "longevity_goals": row.longevity_goals,
            "dietary_constraints": row.dietary_constraints,
            "physical_constraints": row.physical_constraints,
            "updated_at": row.updated_at,
        }
    )


async def replace_profile(session: AsyncSession, data: AthleteProfileReplace) -> AthleteProfileRead:
    row = await _row(session)
    if row is None:
        row = AthleteProfile()
        session.add(row)
    row.display_name = data.display_name
    row.birth_year = data.birth_year
    row.longevity_goals = list(data.longevity_goals)
    row.dietary_constraints = [
        constraint.model_dump(mode="json") for constraint in data.dietary_constraints
    ]
    row.physical_constraints = list(data.physical_constraints)
    await session.commit()
    return await get_profile(session)


def _hits(term: str, name: str, item: str) -> bool:
    lowered = name.lower()
    # "lactose-free milk" and "gluten free pasta" are what the athlete eats.
    item_key = item.strip().lower()
    for free in (f"{item_key}-free", f"{item_key} free", f"{term}-free", f"{term} free"):
        if free in lowered:
            return False
    return re.search(rf"\b{re.escape(term)}(?:e?s)?\b", lowered) is not None


def exclusion_violations(profile: AthleteProfileRead, names: list[str]) -> list[str]:
    """Each ingredient or meal name that hits a severe or strict constraint,
    as 'name (constraint)'. Matching is whole-word, plural-tolerant and
    skips names that say '<item>-free'."""
    found: list[str] = []
    for name in names:
        for constraint in profile.dietary_constraints:
            term = next(
                (t for t in constraint.enforced_terms if _hits(t, name, constraint.item)), None
            )
            if term is not None:
                found.append(f"{name} ({constraint.item}: {constraint.kind})")
                break
    return found
