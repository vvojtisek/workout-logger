from datetime import date, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.coach import write_source
from app.database import get_session
from app.models.base import utcnow
from app.schemas.common import ErrorResponse
from app.schemas.readiness import ReadinessLogCreate, ReadinessLogList, ReadinessLogRead
from app.services import readiness as readiness_service

router = APIRouter(prefix="/readiness-logs", tags=["readiness"])


@router.get(
    "",
    operation_id="list_readiness_logs",
    summary="List readiness check-ins",
    description="Check-ins between two dates (default: the last 7 days), newest first, with score.",
    response_model=ReadinessLogList,
)
async def list_readiness_logs(
    session: Annotated[AsyncSession, Depends(get_session)],
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query()] = None,
) -> ReadinessLogList:
    last = end or utcnow().date()
    first = start or last - timedelta(days=6)
    logs = await readiness_service.list_readiness_logs(session, first, last)
    return ReadinessLogList(items=[ReadinessLogRead.model_validate(log) for log in logs])


@router.post(
    "",
    operation_id="create_readiness_log",
    summary="Log a readiness check-in",
    response_model=ReadinessLogRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_readiness_log(
    data: ReadinessLogCreate,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReadinessLogRead:
    log = await readiness_service.create_readiness_log(session, data, source=write_source(request))
    return ReadinessLogRead.model_validate(log)


@router.delete(
    "/{log_id}",
    operation_id="delete_readiness_log",
    summary="Delete a readiness check-in",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Not found"}},
)
async def delete_readiness_log(
    log_id: UUID, session: Annotated[AsyncSession, Depends(get_session)]
) -> None:
    await readiness_service.delete_readiness_log(session, log_id)
