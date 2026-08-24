from datetime import datetime
from typing import Literal
from uuid import UUID

from app.schemas.common import OrmModel, PaginatedResponse

Role = Literal["admin", "user"]


class UserRead(OrmModel):
    id: UUID
    email: str
    role: Role
    disabled_at: datetime | None
    created_at: datetime
    updated_at: datetime


class PaginatedUsersResponse(PaginatedResponse[UserRead]):
    pass


class ResetPasswordIssued(OrmModel):
    token: str
    expires_at: datetime
