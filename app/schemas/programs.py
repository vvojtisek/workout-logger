from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_non_empty

ProgramStatus = Literal["active", "completed", "archived"]


class ProgramCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    kind: str = Field(min_length=1, max_length=100)
    start_date: date
    end_date: date | None = None
    status: ProgramStatus = "active"
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "name")

    @field_validator("kind")
    @classmethod
    def kind_not_blank(cls, value: str) -> str:
        return require_non_empty(value, "kind")

    @model_validator(mode="after")
    def date_range_is_valid(self) -> "ProgramCreate":
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class ProgramReplace(ProgramCreate):
    pass


class ProgramRead(OrmModel):
    id: UUID
    name: str
    kind: str
    start_date: date
    end_date: date | None
    status: ProgramStatus
    notes: str | None
    created_at: datetime
    updated_at: datetime


class PaginatedProgramsResponse(PaginatedResponse[ProgramRead]):
    pass
