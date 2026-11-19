from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.nutrition_dashboard import NutritionDailySummary, NutritionTrendDay
from app.services import nutrition_dashboard as nutrition_dashboard_service

router = APIRouter(prefix="/nutrition", tags=["nutrition dashboard"])


@router.get(
    "/daily",
    operation_id="get_nutrition_daily_summary",
    summary="Get the daily nutrition summary",
    description=(
        "Returns energy/macro totals for a single UTC calendar day, the applicable "
        "nutrition plan's targets (if any), and the remaining amounts against that "
        "target. Computed at query time from a bounded, indexed range — never stored."
    ),
    response_model=NutritionDailySummary,
)
async def get_nutrition_daily_summary(
    on_date: date = Query(alias="date"),
    session: AsyncSession = Depends(get_session),
) -> NutritionDailySummary:
    return await nutrition_dashboard_service.get_daily_summary(session, on_date)


@router.get(
    "/trends",
    operation_id="get_nutrition_trends",
    summary="Graph nutrition totals and the applicable target for each logged UTC date",
    response_model=list[NutritionTrendDay],
)
async def get_nutrition_trends(
    date_to: Annotated[date, Query(alias="to")],
    session: Annotated[AsyncSession, Depends(get_session)],
    date_from: Annotated[date | None, Query(alias="from")] = None,
) -> list[NutritionTrendDay]:
    return await nutrition_dashboard_service.get_nutrition_trends(session, date_from, date_to)
