"""The action log: one row per REST write or MCP tool call, kept 72 hours.

Rows are written in their own session, after the action itself has
finished, so a failure to log never fails or rolls back the action. Each
write also deletes rows past the retention window, and listing never
returns them, so nothing older than 72 hours is visible even when nothing
has been written for a while.
"""

import json
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session_maker
from app.models import AuditEvent
from app.models.base import utcnow

logger = logging.getLogger("workout_logger.audit")

RETENTION = timedelta(hours=72)

# Values kept verbatim in the parameter summary: identifiers, names and
# dates. Every other value (weights, measurements, notes, passwords, tokens)
# is replaced by its type, so the log shows what was sent but not the data.
_KEPT_KEYS = {
    "name",
    "exercise_name",
    "email",
    "role",
    "scopes",
    "meal_type",
    "activity_type",
    "kind",
    "status",
    "set_number",
    "client_operation_id",
}
_KEPT_SUFFIXES = ("_id", "_date", "_at")
_SECRET_MARKERS = ("password", "token", "secret", "key")
_MAX_VALUE_LENGTH = 100


def _shape(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int | float):
        return "number"
    if isinstance(value, str):
        return "text"
    if isinstance(value, list):
        return f"list[{len(value)}]"
    return "object"


def summarize_params(params: Any) -> dict[str, Any]:
    """Top-level keys of a request body or tool call, with only safe values."""
    if not isinstance(params, dict):
        return {}
    summary: dict[str, Any] = {}
    for key, value in params.items():
        key = str(key)
        lowered = key.lower()
        is_secret = any(marker in lowered for marker in _SECRET_MARKERS)
        is_kept = lowered in _KEPT_KEYS or lowered.endswith(_KEPT_SUFFIXES)
        if is_secret and not lowered.endswith("_id"):
            summary[key] = "[redacted]"
        elif is_kept and isinstance(value, str | int) and not isinstance(value, bool):
            summary[key] = str(value)[:_MAX_VALUE_LENGTH]
        elif is_kept and isinstance(value, list) and all(isinstance(v, str) for v in value):
            summary[key] = [v[:_MAX_VALUE_LENGTH] for v in value[:10]]
        else:
            summary[key] = _shape(value)
    return summary


def _clip(value: str | None, length: int) -> str | None:
    return value[:length] if value else value


async def prune(session: AsyncSession) -> int:
    result = await session.execute(
        delete(AuditEvent).where(AuditEvent.occurred_at < utcnow() - RETENTION)
    )
    await session.commit()
    return getattr(result, "rowcount", 0) or 0


async def record(
    *,
    actor_kind: str,
    actor: str,
    action: str,
    outcome: str,
    params: Any = None,
    actor_subject: str | None = None,
    oauth_client_id: str | None = None,
    oauth_client_name: str | None = None,
    mcp_client_name: str | None = None,
    mcp_client_version: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    status_code: int | None = None,
    error: str | None = None,
    request_id: str | None = None,
) -> None:
    event = AuditEvent(
        occurred_at=utcnow(),
        actor_kind=actor_kind,
        actor=_clip(actor, 255) or "-",
        actor_subject=_clip(actor_subject, 255),
        oauth_client_id=_clip(oauth_client_id, 512),
        oauth_client_name=_clip(oauth_client_name, 255),
        mcp_client_name=_clip(mcp_client_name, 255),
        mcp_client_version=_clip(mcp_client_version, 100),
        action=_clip(action, 200) or "-",
        target_type=_clip(target_type, 64),
        target_id=_clip(target_id, 64),
        outcome=outcome,
        status_code=status_code,
        error=_clip(error, 500),
        params=json.dumps(summarize_params(params), ensure_ascii=False),
        request_id=_clip(request_id, 64),
    )
    try:
        async with get_session_maker()() as session:
            session.add(event)
            await session.flush()
            await prune(session)
    except SQLAlchemyError:
        logger.exception("Could not write action log entry for %s", action)


async def list_events(
    session: AsyncSession, limit: int, offset: int, actor_kind: str | None = None
) -> tuple[list[AuditEvent], int]:
    await prune(session)
    conditions = [AuditEvent.occurred_at >= utcnow() - RETENTION]
    if actor_kind:
        conditions.append(AuditEvent.actor_kind == actor_kind)
    total = await session.scalar(select(func.count()).select_from(AuditEvent).where(*conditions))
    result = await session.execute(
        select(AuditEvent)
        .where(*conditions)
        .order_by(AuditEvent.occurred_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars()), total or 0
