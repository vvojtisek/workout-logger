from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.program_templates import (
    ProgramTemplateInstall,
    ProgramTemplateInstallResult,
    ProgramTemplateListResponse,
)
from app.schemas.programs import ProgramRead
from app.services import program_templates as templates_service

router = APIRouter(prefix="/program-templates", tags=["program-templates"])


@router.get(
    "",
    operation_id="list_program_templates",
    summary="List ready-made programs",
    description="Returns the bundled program templates a user can add to their own plans and calendar.",
    response_model=ProgramTemplateListResponse,
)
async def list_program_templates() -> ProgramTemplateListResponse:
    return ProgramTemplateListResponse(
        items=[templates_service.to_read(t) for t in templates_service.load_templates().values()]
    )


@router.post(
    "/{key}/install",
    operation_id="install_program_template",
    summary="Add a ready-made program to your account",
    description=(
        "Copies the template's workout plans into the caller's account, creates a program and "
        "schedules every session on the calendar from `start_date`. Weekly templates start on "
        "the first Monday on or after `start_date`; sequence templates use `weekdays` "
        "(Monday = 0) or the template's defaults."
    ),
    response_model=ProgramTemplateInstallResult,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse, "description": "Unknown template"},
        409: {"model": ErrorResponse, "description": "Template plans already exist"},
    },
)
async def install_program_template(
    key: str,
    data: ProgramTemplateInstall,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProgramTemplateInstallResult:
    program, plans, scheduled_count = await templates_service.install_template(session, key, data)
    return ProgramTemplateInstallResult(
        program=ProgramRead.model_validate(program),
        plan_ids=[plan.id for plan in plans],
        scheduled_count=scheduled_count,
    )
