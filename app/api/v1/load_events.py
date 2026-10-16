from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.load_events import (
    LoadEventCreate,
    LoadEventRead,
    LoadEventReplace,
    PaginatedLoadEventsResponse,
)
from app.services import load_events as load_events_service

router = APIRouter(prefix="/load-events", tags=["load-events"])

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Load event not found"}
}


@router.get(
    "",
    operation_id="list_load_events",
    summary="List recurring sport events",
    description=(
        "Returns recurring games and practices (for example ice hockey), "
        "sorted by weekday (Monday is 0) and start time."
    ),
    response_model=PaginatedLoadEventsResponse,
)
async def list_load_events(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedLoadEventsResponse:
    items, total = await load_events_service.list_load_events(session, limit, offset)
    return PaginatedLoadEventsResponse(
        items=[LoadEventRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_load_event",
    summary="Create a recurring sport event",
    description="Creates a weekly game or practice that repeats between season_start and season_end.",
    response_model=LoadEventRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_load_event(
    data: LoadEventCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> LoadEventRead:
    event = await load_events_service.create_load_event(session, data)
    response.headers["Location"] = f"/api/v1/load-events/{event.id}"
    return LoadEventRead.model_validate(event)


@router.get(
    "/{event_id}",
    operation_id="get_load_event",
    summary="Get a recurring sport event",
    description="Returns a single recurring game or practice.",
    response_model=LoadEventRead,
    responses=_NOT_FOUND,
)
async def get_load_event(
    event_id: UUID, session: AsyncSession = Depends(get_session)
) -> LoadEventRead:
    event = await load_events_service.get_load_event(session, event_id)
    return LoadEventRead.model_validate(event)


@router.put(
    "/{event_id}",
    operation_id="replace_load_event",
    summary="Replace a recurring sport event",
    description="Fully replaces a recurring game or practice.",
    response_model=LoadEventRead,
    responses=_NOT_FOUND,
)
async def replace_load_event(
    event_id: UUID,
    data: LoadEventReplace,
    session: AsyncSession = Depends(get_session),
) -> LoadEventRead:
    event = await load_events_service.replace_load_event(session, event_id, data)
    return LoadEventRead.model_validate(event)


@router.delete(
    "/{event_id}",
    operation_id="delete_load_event",
    summary="Delete a recurring sport event",
    description="Deletes a recurring game or practice.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_NOT_FOUND,
)
async def delete_load_event(event_id: UUID, session: AsyncSession = Depends(get_session)) -> None:
    await load_events_service.delete_load_event(session, event_id)
