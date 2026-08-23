from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.calendar import CalendarRangeQuery, CalendarResponse
from app.schemas.scheduled_workouts import ScheduledWorkoutRead
from app.services import scheduled_workouts as scheduled_workouts_service

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.get(
    "",
    operation_id="get_calendar",
    summary="Get scheduled workouts in a date range",
    description=(
        "Returns scheduled workouts within a bounded [from, to] date range "
        "(inclusive, at most 366 days)."
    ),
    response_model=CalendarResponse,
)
async def get_calendar(
    query: Annotated[CalendarRangeQuery, Query()],
    session: AsyncSession = Depends(get_session),
) -> CalendarResponse:
    items = await scheduled_workouts_service.get_calendar(session, query.date_from, query.date_to)
    return CalendarResponse(items=[ScheduledWorkoutRead.model_validate(item) for item in items])
