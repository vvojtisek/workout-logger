from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services import export as export_service

router = APIRouter(prefix="/export", tags=["export"])


@router.get(
    "",
    operation_id="export_data",
    summary="Export all personal data",
    description="A full export of every logged domain (plans, exercises, programs, scheduled "
    "workouts, sessions, body metrics, foods, nutrition plans, meal entries, sleep entries, "
    "step counts) as either one JSON document or a zip of one CSV per domain. Excludes API "
    "tokens and in-progress workout-session state, neither of which is personal record data.",
)
async def export_data(
    format: Literal["json", "csv"] = Query(default="json"),
    session: AsyncSession = Depends(get_session),
) -> Response:
    data = await export_service.gather_export(session)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    if format == "csv":
        archive = export_service.to_csv_zip(data)
        return Response(
            content=archive,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="workout-logger-export-{stamp}.zip"'
            },
        )

    payload = export_service.to_json(data)
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": f'attachment; filename="workout-logger-export-{stamp}.json"'
        },
    )
