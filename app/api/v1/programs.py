from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.common import ErrorResponse
from app.schemas.programs import (
    PaginatedProgramsResponse,
    ProgramCreate,
    ProgramRead,
    ProgramReplace,
)
from app.services import programs as programs_service

router = APIRouter(prefix="/programs", tags=["programs"])


@router.get(
    "",
    operation_id="list_programs",
    summary="List programs",
    description="Returns a paginated list of programs, most recently started first.",
    response_model=PaginatedProgramsResponse,
)
async def list_programs(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedProgramsResponse:
    items, total = await programs_service.list_programs(session, limit, offset)
    return PaginatedProgramsResponse(
        items=[ProgramRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    operation_id="create_program",
    summary="Create a program",
    description="Creates a named date-range program block. Overlapping programs are allowed.",
    response_model=ProgramRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_program(
    data: ProgramCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> ProgramRead:
    program = await programs_service.create_program(session, data)
    response.headers["Location"] = f"/api/v1/programs/{program.id}"
    return ProgramRead.model_validate(program)


@router.get(
    "/{program_id}",
    operation_id="get_program",
    summary="Get a program",
    description="Returns a single program.",
    response_model=ProgramRead,
    responses={404: {"model": ErrorResponse, "description": "Program not found"}},
)
async def get_program(
    program_id: UUID, session: AsyncSession = Depends(get_session)
) -> ProgramRead:
    program = await programs_service.get_program(session, program_id)
    return ProgramRead.model_validate(program)


@router.put(
    "/{program_id}",
    operation_id="replace_program",
    summary="Replace a program",
    description="Fully replaces a program.",
    response_model=ProgramRead,
    responses={404: {"model": ErrorResponse, "description": "Program not found"}},
)
async def replace_program(
    program_id: UUID,
    data: ProgramReplace,
    session: AsyncSession = Depends(get_session),
) -> ProgramRead:
    program = await programs_service.replace_program(session, program_id, data)
    return ProgramRead.model_validate(program)


@router.delete(
    "/{program_id}",
    operation_id="delete_program",
    summary="Delete a program",
    description="Deletes a program and unschedules its workouts.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Program not found"}},
)
async def delete_program(program_id: UUID, session: AsyncSession = Depends(get_session)) -> None:
    await programs_service.delete_program(session, program_id)
