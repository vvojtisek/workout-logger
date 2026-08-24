from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import Program
from app.schemas.programs import ProgramCreate, ProgramReplace


async def list_programs(
    session: AsyncSession, limit: int, offset: int
) -> tuple[list[Program], int]:
    total = await session.scalar(select(func.count()).select_from(Program))
    result = await session.execute(
        select(Program).order_by(Program.start_date.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars().all()), total or 0


async def get_program(session: AsyncSession, program_id: UUID) -> Program:
    result = await session.execute(select(Program).where(Program.id == program_id))
    program = result.scalar_one_or_none()
    if program is None:
        raise NotFoundError("Program not found", code="PROGRAM_NOT_FOUND")
    return program


async def create_program(session: AsyncSession, data: ProgramCreate) -> Program:
    program = Program(**data.model_dump())
    session.add(program)
    await session.commit()
    await session.refresh(program)
    return program


async def replace_program(session: AsyncSession, program_id: UUID, data: ProgramReplace) -> Program:
    program = await get_program(session, program_id)
    for field, value in data.model_dump().items():
        setattr(program, field, value)
    await session.commit()
    await session.refresh(program)
    return program


async def delete_program(session: AsyncSession, program_id: UUID) -> None:
    program = await get_program(session, program_id)
    await session.delete(program)
    await session.commit()
