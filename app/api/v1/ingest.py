from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.body_metrics import BodyMetricRead
from app.schemas.ingest import (
    SessionIngestCreate,
    SessionIngestResult,
    SleepIngestCreate,
    SleepIngestResult,
    StepCountRead,
    StepsIngestCreate,
    StepsIngestResult,
    WeightIngestCreate,
    WeightIngestResult,
)
from app.schemas.logs import WorkoutLogRead
from app.schemas.sleep_entries import SleepEntryRead
from app.services import ingest as ingest_service

router = APIRouter(prefix="/ingest", tags=["ingest"])

_DESCRIPTION = (
    "Idempotent for a given (source, external_id) pair: replaying the same sync record "
    "returns the row already stored, rather than creating a duplicate or erroring. "
    "Status is 201 the first time a record is ingested and 200 on every replay."
)


@router.post(
    "/weight",
    operation_id="ingest_weight",
    summary="Ingest a weight measurement",
    description=_DESCRIPTION,
    response_model=WeightIngestResult,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_weight(
    data: WeightIngestCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> WeightIngestResult:
    metric, created = await ingest_service.ingest_weight(session, data)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return WeightIngestResult(**BodyMetricRead.model_validate(metric).model_dump(), created=created)


@router.post(
    "/sleep",
    operation_id="ingest_sleep",
    summary="Ingest a sleep entry",
    description=_DESCRIPTION,
    response_model=SleepIngestResult,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_sleep(
    data: SleepIngestCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> SleepIngestResult:
    entry, created = await ingest_service.ingest_sleep(session, data)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return SleepIngestResult(**SleepEntryRead.model_validate(entry).model_dump(), created=created)


@router.post(
    "/sessions",
    operation_id="ingest_session",
    summary="Ingest a completed workout session",
    description=_DESCRIPTION,
    response_model=SessionIngestResult,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_session(
    data: SessionIngestCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> SessionIngestResult:
    log, created = await ingest_service.ingest_session(session, data)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return SessionIngestResult(**WorkoutLogRead.model_validate(log).model_dump(), created=created)


@router.post(
    "/steps",
    operation_id="ingest_steps",
    summary="Ingest a daily step count",
    description=_DESCRIPTION,
    response_model=StepsIngestResult,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_steps(
    data: StepsIngestCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> StepsIngestResult:
    step_count, created = await ingest_service.ingest_steps(session, data)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return StepsIngestResult(
        **StepCountRead.model_validate(step_count).model_dump(), created=created
    )
