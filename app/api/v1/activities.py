from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.activity_defaults import ActivityDefaultsResponse, PrefillCategory
from app.services import activity_defaults as defaults_service

router = APIRouter(prefix="/activities", tags=["activities"])


@router.get(
    "/defaults",
    operation_id="get_activity_defaults",
    summary="Predict the defaults for a cardio or recovery log",
    description=(
        "Pre-fill values for logging a cardio/sport or recovery session on `date`, from the "
        "last `weeks` weeks of entries: the most likely activity type for that weekday, its "
        "usual local start (rounded to 15 min), duration, effort level 1-5 and recovery "
        "cycles, every type ranked, the weekday's frequent start times, one-tap recovery "
        "presets and the same day's sessions a recovery entry can follow. `date` defaults to "
        "today in `timezone`; with only `day_of_week` (0 Monday .. 6 Sunday) it is the latest "
        "such day up to today."
    ),
    response_model=ActivityDefaultsResponse,
)
async def get_activity_defaults(
    session: Annotated[AsyncSession, Depends(get_session)],
    category: Annotated[PrefillCategory, Query()] = "cardio",
    on_date: Annotated[date | None, Query(alias="date")] = None,
    day_of_week: Annotated[int | None, Query(ge=0, le=6)] = None,
    timezone: Annotated[
        str, Query(min_length=1, max_length=50, examples=["Europe/Prague"])
    ] = "UTC",
    weeks: Annotated[int, Query(ge=4, le=12)] = 8,
) -> ActivityDefaultsResponse:
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(
            status_code=422, detail=f"'{timezone}' is not a recognized IANA timezone name"
        ) from exc
    today = datetime.now(zone).date()
    if on_date is None:
        on_date = today
        if day_of_week is not None:
            on_date = today - timedelta(days=(today.weekday() - day_of_week) % 7)
    elif day_of_week is not None and on_date.weekday() != day_of_week:
        raise HTTPException(
            status_code=422,
            detail=f"day_of_week {day_of_week} does not match {on_date.isoformat()}, "
            f"which is day {on_date.weekday()} (0 Monday .. 6 Sunday)",
        )
    return await defaults_service.predict_defaults(
        session, day=on_date, category=category, tz_name=timezone, weeks=weeks
    )
