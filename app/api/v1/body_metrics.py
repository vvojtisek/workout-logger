from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.body_metrics import (
    BodyMetricCreate,
    BodyMetricRead,
    BodyMetricReplace,
    BodyMetricTrends,
    PaginatedBodyMetricsResponse,
)
from app.schemas.common import ErrorResponse
from app.services import body_metrics as body_metrics_service

router = APIRouter(prefix="/body-metrics", tags=["body metrics"])


@router.get(
    "",
    operation_id="list_body_metrics",
    summary="List body metric entries",
    description="Returns a paginated list of body metric entries, most recent first.",
    response_model=PaginatedBodyMetricsResponse,
)
async def list_body_metrics(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedBodyMetricsResponse:
    items, total = await body_metrics_service.list_body_metrics(session, limit, offset)
    return PaginatedBodyMetricsResponse(
        items=[BodyMetricRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/trends",
    operation_id="get_body_metric_trends",
    summary="Get rolling weight/body-fat trends",
    description=(
        "Returns the latest body metric entry plus 7- and 14-day weight and body-fat "
        "deltas, computed at query time from the closest prior measurement."
    ),
    response_model=BodyMetricTrends,
)
async def get_body_metric_trends(
    session: AsyncSession = Depends(get_session),
) -> BodyMetricTrends:
    return await body_metrics_service.get_trends(session)


@router.post(
    "",
    operation_id="create_body_metric",
    summary="Log a body metric entry",
    response_model=BodyMetricRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_body_metric(
    data: BodyMetricCreate,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> BodyMetricRead:
    body_metric = await body_metrics_service.create_body_metric(session, data)
    response.headers["Location"] = f"/api/v1/body-metrics/{body_metric.id}"
    return BodyMetricRead.model_validate(body_metric)


@router.get(
    "/{body_metric_id}",
    operation_id="get_body_metric",
    summary="Get a body metric entry",
    response_model=BodyMetricRead,
    responses={404: {"model": ErrorResponse, "description": "Body metric entry not found"}},
)
async def get_body_metric(
    body_metric_id: UUID, session: AsyncSession = Depends(get_session)
) -> BodyMetricRead:
    body_metric = await body_metrics_service.get_body_metric(session, body_metric_id)
    return BodyMetricRead.model_validate(body_metric)


@router.put(
    "/{body_metric_id}",
    operation_id="replace_body_metric",
    summary="Replace a body metric entry",
    response_model=BodyMetricRead,
    responses={404: {"model": ErrorResponse, "description": "Body metric entry not found"}},
)
async def replace_body_metric(
    body_metric_id: UUID,
    data: BodyMetricReplace,
    session: AsyncSession = Depends(get_session),
) -> BodyMetricRead:
    body_metric = await body_metrics_service.replace_body_metric(session, body_metric_id, data)
    return BodyMetricRead.model_validate(body_metric)


@router.delete(
    "/{body_metric_id}",
    operation_id="delete_body_metric",
    summary="Delete a body metric entry",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": ErrorResponse, "description": "Body metric entry not found"}},
)
async def delete_body_metric(
    body_metric_id: UUID, session: AsyncSession = Depends(get_session)
) -> None:
    await body_metrics_service.delete_body_metric(session, body_metric_id)
