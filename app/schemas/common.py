from datetime import datetime, timezone
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PaginatedResponse(OrmModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class ErrorResponse(BaseModel):
    detail: str
    code: str
    request_id: str


class HealthResponse(BaseModel):
    status: str
    database: str
    version: str


def require_non_empty(value: str, field_name: str = "value") -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError(f"{field_name} must not be empty")
    return stripped


def require_timezone_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("datetime must include a timezone")
    return value.astimezone(timezone.utc)
