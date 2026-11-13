from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.quick_add_presets import (
    QuickAddPresetCreate,
    QuickAddPresetList,
    QuickAddPresetRead,
    QuickAddPresetReplace,
)
from app.services import quick_add_presets as presets_service

router = APIRouter(prefix="/quick-add-presets", tags=["foods"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"model": ErrorResponse, "description": "Quick-add preset not found"}
}


@router.get(
    "",
    operation_id="list_quick_add_presets",
    summary="List quick-add presets",
    description=(
        "Returns the one-tap drink presets (such as Cappuccino and Tea) in display order. "
        "Values are for the whole serving. Logging one is a normal meal entry with an ad hoc "
        "item built from these values."
    ),
    response_model=QuickAddPresetList,
)
async def list_quick_add_presets(session: SessionDep) -> QuickAddPresetList:
    items = await presets_service.list_presets(session)
    return QuickAddPresetList(items=[QuickAddPresetRead.model_validate(item) for item in items])


@router.post(
    "",
    operation_id="create_quick_add_preset",
    summary="Create a quick-add preset",
    response_model=QuickAddPresetRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_quick_add_preset(
    data: QuickAddPresetCreate, response: Response, session: SessionDep
) -> QuickAddPresetRead:
    preset = await presets_service.create_preset(session, data)
    response.headers["Location"] = f"/api/v1/quick-add-presets/{preset.id}"
    return QuickAddPresetRead.model_validate(preset)


@router.put(
    "/{preset_id}",
    operation_id="replace_quick_add_preset",
    summary="Replace a quick-add preset",
    description="Fully replaces a preset. Drinks already logged keep their snapshot.",
    response_model=QuickAddPresetRead,
    responses=_NOT_FOUND,
)
async def replace_quick_add_preset(
    preset_id: UUID, data: QuickAddPresetReplace, session: SessionDep
) -> QuickAddPresetRead:
    preset = await presets_service.replace_preset(session, preset_id, data)
    return QuickAddPresetRead.model_validate(preset)


@router.delete(
    "/{preset_id}",
    operation_id="delete_quick_add_preset",
    summary="Delete a quick-add preset",
    description="Deletes a preset. Drinks already logged keep their snapshot.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_NOT_FOUND,
)
async def delete_quick_add_preset(preset_id: UUID, session: SessionDep) -> None:
    await presets_service.delete_preset(session, preset_id)
