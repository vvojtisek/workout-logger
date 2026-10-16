from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.locations import (
    LocationCreate,
    LocationRead,
    LocationReplace,
    PaginatedLocationsResponse,
)
from app.services import locations as locations_service

router = APIRouter(prefix="/locations", tags=["locations"])

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Location not found"}
}
_CONFLICT: dict[int | str, dict[str, Any]] = {
    409: {"model": ErrorResponse, "description": "Duplicate location name"}
}


@router.get(
    "",
    operation_id="list_locations",
    summary="List locations",
    description="Returns the places you train and the equipment each has, sorted by name.",
    response_model=PaginatedLocationsResponse,
)
async def list_locations(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedLocationsResponse:
    items, total = await locations_service.list_locations(session, limit, offset)
    return PaginatedLocationsResponse(
        items=[LocationRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_location",
    summary="Create a location",
    description="Creates a place to train with its equipment tags.",
    response_model=LocationRead,
    status_code=status.HTTP_201_CREATED,
    responses=_CONFLICT,
)
async def create_location(
    data: LocationCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> LocationRead:
    location = await locations_service.create_location(session, data)
    response.headers["Location"] = f"/api/v1/locations/{location.id}"
    return LocationRead.model_validate(location)


@router.get(
    "/{location_id}",
    operation_id="get_location",
    summary="Get a location",
    description="Returns a single location.",
    response_model=LocationRead,
    responses=_NOT_FOUND,
)
async def get_location(
    location_id: UUID, session: AsyncSession = Depends(get_session)
) -> LocationRead:
    location = await locations_service.get_location(session, location_id)
    return LocationRead.model_validate(location)


@router.put(
    "/{location_id}",
    operation_id="replace_location",
    summary="Replace a location",
    description="Fully replaces a location.",
    response_model=LocationRead,
    responses={**_NOT_FOUND, **_CONFLICT},
)
async def replace_location(
    location_id: UUID,
    data: LocationReplace,
    session: AsyncSession = Depends(get_session),
) -> LocationRead:
    location = await locations_service.replace_location(session, location_id, data)
    return LocationRead.model_validate(location)


@router.delete(
    "/{location_id}",
    operation_id="delete_location",
    summary="Delete a location",
    description="Deletes a location.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_NOT_FOUND,
)
async def delete_location(location_id: UUID, session: AsyncSession = Depends(get_session)) -> None:
    await locations_service.delete_location(session, location_id)
