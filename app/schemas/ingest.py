from datetime import date, datetime
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.body_metrics import BodyMetricCreate, BodyMetricRead
from app.schemas.common import OrmModel, require_non_empty
from app.schemas.logs import WorkoutLogCreate, WorkoutLogRead
from app.schemas.sleep_entries import SleepEntryCreate, SleepEntryRead

# A source name is a short slug the syncing app chooses for itself (e.g.
# "health_connect", "garmin"), not a value the user picks per request.
_SOURCE_MAX_LEN = 30
_EXTERNAL_ID_MAX_LEN = 200


class WeightIngestCreate(BodyMetricCreate):
    source: str = Field(min_length=1, max_length=_SOURCE_MAX_LEN)
    external_id: str = Field(min_length=1, max_length=_EXTERNAL_ID_MAX_LEN)

    @field_validator("source", "external_id")
    @classmethod
    def field_not_blank(cls, value: str, info) -> str:
        return require_non_empty(value, info.field_name)


class SleepIngestCreate(SleepEntryCreate):
    source: str = Field(min_length=1, max_length=_SOURCE_MAX_LEN)
    external_id: str = Field(min_length=1, max_length=_EXTERNAL_ID_MAX_LEN)

    @field_validator("source", "external_id")
    @classmethod
    def field_not_blank(cls, value: str, info) -> str:
        return require_non_empty(value, info.field_name)


class SessionIngestCreate(WorkoutLogCreate):
    source: str = Field(min_length=1, max_length=_SOURCE_MAX_LEN)
    external_id: str = Field(min_length=1, max_length=_EXTERNAL_ID_MAX_LEN)

    @field_validator("source", "external_id")
    @classmethod
    def field_not_blank(cls, value: str, info) -> str:
        return require_non_empty(value, info.field_name)


class StepsIngestCreate(OrmModel):
    recorded_date: date
    steps: int = Field(ge=0, le=200_000)
    source: str = Field(min_length=1, max_length=_SOURCE_MAX_LEN)
    external_id: str = Field(min_length=1, max_length=_EXTERNAL_ID_MAX_LEN)

    @field_validator("source", "external_id")
    @classmethod
    def field_not_blank(cls, value: str, info) -> str:
        return require_non_empty(value, info.field_name)


class StepCountRead(OrmModel):
    id: UUID
    recorded_date: date
    steps: int
    source: str
    external_id: str | None
    created_at: datetime
    updated_at: datetime


class WeightIngestResult(BodyMetricRead):
    """`created` is false when this response is the row a prior sync already
    wrote for this source+external_id, rather than a newly ingested one."""

    created: bool


class SleepIngestResult(SleepEntryRead):
    created: bool


class SessionIngestResult(WorkoutLogRead):
    created: bool


class StepsIngestResult(StepCountRead):
    created: bool
