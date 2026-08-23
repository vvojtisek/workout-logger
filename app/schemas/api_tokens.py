from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty

Scope = Literal["read", "log", "admin"]
ALL_SCOPES: tuple[Scope, ...] = ("read", "log", "admin")


class ApiTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[Scope] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @field_validator("scopes")
    @classmethod
    def scopes_deduplicated(cls, value: list[Scope]) -> list[Scope]:
        deduped = sorted(set(value), key=ALL_SCOPES.index)
        if not deduped:
            raise ValueError("scopes must not be empty")
        return deduped


class ApiTokenRead(OrmModel):
    id: UUID
    name: str
    scopes: list[Scope]
    token_prefix: str
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @field_validator("scopes", mode="before")
    @classmethod
    def split_scopes(cls, value: object) -> object:
        if isinstance(value, str):
            return value.split(",")
        return value


class ApiTokenCreated(ApiTokenRead):
    """Returned only once, at creation time. The raw secret is never stored."""

    token: str


class PaginatedApiTokensResponse(PaginatedResponse[ApiTokenRead]):
    pass
