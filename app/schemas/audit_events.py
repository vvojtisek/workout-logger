import json
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import field_validator

from app.schemas.common import OrmModel, PaginatedResponse


class AuditEventRead(OrmModel):
    id: UUID
    occurred_at: datetime
    actor_kind: str
    actor: str
    actor_subject: str | None
    oauth_client_id: str | None
    oauth_client_name: str | None
    mcp_client_name: str | None
    mcp_client_version: str | None
    action: str
    target_type: str | None
    target_id: str | None
    outcome: str
    status_code: int | None
    error: str | None
    params: dict[str, Any]
    request_id: str | None

    @field_validator("params", mode="before")
    @classmethod
    def decode_params(cls, value: Any) -> Any:
        return json.loads(value) if isinstance(value, str) else value


class PaginatedAuditEventsResponse(PaginatedResponse[AuditEventRead]):
    retention_hours: int
