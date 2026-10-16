from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.food_catalog import CatalogSearchResponse
from app.schemas.foods import FoodRead
from app.services import food_catalog as catalog_service

router = APIRouter(prefix="/food-catalog", tags=["foods"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "",
    operation_id="search_food_catalog",
    summary="Search the fallback food catalogue",
    description=(
        "Searches the bundled food catalogue (per 100 g) by name, ignoring case and "
        "diacritics. Use it when a food is missing from your foods; `food_id` is set on "
        "entries that were already added."
    ),
    response_model=CatalogSearchResponse,
)
async def search_food_catalog(
    session: SessionDep,
    q: Annotated[str, Query(min_length=2, max_length=100)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> CatalogSearchResponse:
    matches = catalog_service.search(q)
    page = matches[:limit]
    added = await catalog_service.added_food_ids(session, [entry.id for entry in page])
    return CatalogSearchResponse(
        items=[catalog_service.to_read(entry, added.get(entry.id)) for entry in page],
        total=len(matches),
        limit=limit,
    )


@router.post(
    "/{catalog_id}/add",
    operation_id="add_food_from_catalog",
    summary="Add a catalogue food to your foods",
    description=(
        "Copies one catalogue entry into your foods (per 100 g). Returns 201 with the new "
        "food, or 200 with the food added earlier if this entry is already in your foods."
    ),
    response_model=FoodRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": FoodRead, "description": "Already added"},
        404: {"model": ErrorResponse, "description": "Catalogue food not found"},
    },
)
async def add_food_from_catalog(
    response: Response,
    session: SessionDep,
    catalog_id: Annotated[str, Path(min_length=1, max_length=64)],
) -> FoodRead:
    food, created = await catalog_service.add_to_foods(session, catalog_id)
    if not created:
        response.status_code = status.HTTP_200_OK
    response.headers["Location"] = f"/api/v1/foods/{food.id}"
    return FoodRead.model_validate(food)
