from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.sleep_entries import (
    PaginatedSleepEntriesResponse,
    SleepEntryCreate,
    SleepEntryRead,
    SleepEntryReplace,
    SleepTrends,
)
from app.services import sleep_entries as sleep_entries_service

router = APIRouter(prefix="/sleep-entries", tags=["sleep"])


@router.get(
    "",
    operation_id="list_sleep_entries",
    summary="List sleep entries",
    description="Returns a paginated list of sleep entries, most recent first.",
    response_model=PaginatedSleepEntriesResponse,
)
async def list_sleep_entries(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedSleepEntriesResponse:
    items, total = await sleep_entries_service.list_sleep_entries(session, limit, offset)
    return PaginatedSleepEntriesResponse(
        items=[SleepEntryRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/trends",
    operation_id="get_sleep_trends",
    summary="Get rolling sleep duration/quality trends",
    description=(
        "Returns the latest sleep entry plus 7- and 30-day average sleep duration and "
        "quality, computed at query time using each entry's own timezone to attribute it "
        "to the calendar day the sleeper woke up on."
    ),
    response_model=SleepTrends,
)
async def get_sleep_trends(session: AsyncSession = Depends(get_session)) -> SleepTrends:
    return await sleep_entries_service.get_trends(session)


@router.post(
    "",
    operation_id="create_sleep_entry",
    summary="Log a sleep entry",
    response_model=SleepEntryRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_sleep_entry(
    data: SleepEntryCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> SleepEntryRead:
    sleep_entry = await sleep_entries_service.create_sleep_entry(session, data)
    response.headers["Location"] = f"/api/v1/sleep-entries/{sleep_entry.id}"
    return SleepEntryRead.model_validate(sleep_entry)


@router.get(
    "/{sleep_entry_id}",
    operation_id="get_sleep_entry",
    summary="Get a sleep entry",
    response_model=SleepEntryRead,
    responses={404: {"model": ErrorResponse, "description": "Sleep entry not found"}},
)
async def get_sleep_entry(
    sleep_entry_id: UUID, session: AsyncSession = Depends(get_session)
) -> SleepEntryRead:
    sleep_entry = await sleep_entries_service.get_sleep_entry(session, sleep_entry_id)
    return SleepEntryRead.model_validate(sleep_entry)


@router.put(
    "/{sleep_entry_id}",
    operation_id="replace_sleep_entry",
    summary="Replace a sleep entry",
    response_model=SleepEntryRead,
    responses={404: {"model": ErrorResponse, "description": "Sleep entry not found"}},
)
async def replace_sleep_entry(
    sleep_entry_id: UUID,
    data: SleepEntryReplace,
    session: AsyncSession = Depends(get_session),
) -> SleepEntryRead:
    sleep_entry = await sleep_entries_service.replace_sleep_entry(session, sleep_entry_id, data)
    return SleepEntryRead.model_validate(sleep_entry)


@router.delete(
    "/{sleep_entry_id}",
    operation_id="delete_sleep_entry",
    summary="Delete a sleep entry",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Sleep entry not found"}},
)
async def delete_sleep_entry(
    sleep_entry_id: UUID, session: AsyncSession = Depends(get_session)
) -> None:
    await sleep_entries_service.delete_sleep_entry(session, sleep_entry_id)
