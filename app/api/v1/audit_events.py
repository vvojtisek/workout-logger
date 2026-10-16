from typing import Literal

from fastapi import APIRouter, Depends, Query, Security
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.audit_events import AuditEventRead, PaginatedAuditEventsResponse
from app.security import require_admin
from app.services import audit_log

router = APIRouter(
    prefix="/audit-events", tags=["audit events"], dependencies=[Security(require_admin)]
)


@router.get(
    "",
    operation_id="list_audit_events",
    summary="List the action log",
    description="Every REST write and MCP tool call from the last 72 hours, newest first, "
    "with who caused it. Admin only. Health values, passwords and tokens are never stored.",
    response_model=PaginatedAuditEventsResponse,
)
async def list_audit_events(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    actor_kind: Literal["user", "api_token", "api_key", "mcp", "anonymous"] | None = None,
    session: AsyncSession = Depends(get_session),
) -> PaginatedAuditEventsResponse:
    items, total = await audit_log.list_events(session, limit, offset, actor_kind)
    return PaginatedAuditEventsResponse(
        items=[AuditEventRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
        retention_hours=int(audit_log.RETENTION.total_seconds() // 3600),
    )
