from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.calendar import CalendarRangeQuery, CalendarResponse
from app.schemas.scheduled_workouts import ScheduledWorkoutRead
from app.services import load_events as load_events_service
from app.services import load_warnings as load_warnings_service
from app.services import scheduled_workouts as scheduled_workouts_service

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.get(
    "",
    operation_id="get_calendar",
    summary="Get scheduled workouts and sport events in a date range",
    description=(
        "Returns scheduled workouts and recurring game and practice occurrences "
        "within a bounded [from, to] date range (inclusive, at most 366 days), "
        "plus warnings for scheduled heavy leg work within 24 hours before a game "
        "or 12 hours before a practice."
    ),
    response_model=CalendarResponse,
)
async def get_calendar(
    query: Annotated[CalendarRangeQuery, Query()],
    session: AsyncSession = Depends(get_session),
) -> CalendarResponse:
    items = await scheduled_workouts_service.get_calendar(session, query.date_from, query.date_to)
    load_events = await load_events_service.get_occurrences(session, query.date_from, query.date_to)
    return CalendarResponse(
        items=[ScheduledWorkoutRead.model_validate(item) for item in items],
        load_events=load_events,
        load_warnings=await load_warnings_service.get_warnings(
            session, items, query.date_from, query.date_to
        ),
    )
