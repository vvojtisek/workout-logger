from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.base import utcnow
from app.schemas.common import ErrorResponse
from app.schemas.meal_plans import SupplementList, SupplementRead, SupplementsDue
from app.services import supplements as supplements_service

router = APIRouter(prefix="/supplements", tags=["supplements"])
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Supplement not found"}
}


@router.get(
    "",
    operation_id="list_supplements",
    summary="List the active supplement stack",
    response_model=SupplementList,
)
async def list_supplements(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SupplementList:
    rows = await supplements_service.list_active(session)
    return SupplementList(items=[SupplementRead.model_validate(row) for row in rows])


@router.get(
    "/due",
    operation_id="get_supplements_due",
    summary="Supplements due on a date",
    description="The stack filtered by training, rest and hockey days, with what was taken.",
    response_model=SupplementsDue,
)
async def get_due(
    session: Annotated[AsyncSession, Depends(get_session)],
    on: Annotated[date | None, Query(alias="date")] = None,
) -> SupplementsDue:
    return await supplements_service.due_on(session, on or utcnow().date())


@router.put(
    "/{schedule_id}/intakes/{intake_date}",
    operation_id="mark_supplement_taken",
    summary="Mark a supplement taken",
    response_model=SupplementsDue,
    responses=_NOT_FOUND,
)
async def mark_taken(
    schedule_id: UUID, intake_date: date, session: Annotated[AsyncSession, Depends(get_session)]
) -> SupplementsDue:
    return await supplements_service.mark_taken(session, schedule_id, intake_date)


@router.delete(
    "/{schedule_id}/intakes/{intake_date}",
    operation_id="unmark_supplement_taken",
    summary="Undo marking a supplement taken",
    response_model=SupplementsDue,
    responses=_NOT_FOUND,
)
async def unmark_taken(
    schedule_id: UUID, intake_date: date, session: Annotated[AsyncSession, Depends(get_session)]
) -> SupplementsDue:
    return await supplements_service.unmark_taken(session, schedule_id, intake_date)


@router.delete(
    "/{schedule_id}",
    operation_id="delete_supplement",
    summary="Delete a supplement and its intake history",
    description="To stop one but keep its history, leave it out of the next supplement_stack.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_NOT_FOUND,
)
async def delete_supplement(
    schedule_id: UUID, session: Annotated[AsyncSession, Depends(get_session)]
) -> None:
    await supplements_service.delete_schedule(session, schedule_id)
