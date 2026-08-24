import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.config import get_settings
from app.schemas.common import OrmModel, PaginatedResponse
from app.schemas.users import Role

InviteStatus = Literal["pending", "accepted", "revoked", "expired"]

# Deliberately lightweight (not full RFC 5322/email-validator): this is an
# admin-typed address for an out-of-band invite, not a self-service signup
# form, and a stricter validator would reject reserved test TLDs like
# `.test` that the rest of this codebase's test suite already relies on.
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InviteCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    role: Role = "user"

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _EMAIL_PATTERN.match(normalized):
            raise ValueError("email must be a valid email address")
        return normalized


class InviteRead(OrmModel):
    id: UUID
    email: str
    role: Role
    status: InviteStatus
    expires_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class InviteCreated(InviteRead):
    """Returned only once, at creation time. The raw token is never stored."""

    token: str


class PaginatedInvitesResponse(PaginatedResponse[InviteRead]):
    pass


class AcceptInviteRequest(BaseModel):
    token: str = Field(min_length=1)
    password: str = Field(min_length=1)

    @field_validator("password")
    @classmethod
    def password_meets_minimum_length(cls, value: str) -> str:
        min_length = get_settings().PASSWORD_MIN_LENGTH
        if len(value) < min_length:
            raise ValueError(f"password must be at least {min_length} characters")
        return value
