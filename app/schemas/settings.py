from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import OrmModel

Units = Literal["metric", "imperial"]


class UserSettingsUpdate(BaseModel):
    units: Units = "metric"
    default_rest_compound_seconds: int = Field(default=90, ge=0, le=3600)
    default_rest_isolation_seconds: int = Field(default=60, ge=0, le=3600)


class UserSettingsRead(OrmModel):
    id: UUID
    units: Units
    default_rest_compound_seconds: int
    default_rest_isolation_seconds: int
    created_at: datetime
    updated_at: datetime
