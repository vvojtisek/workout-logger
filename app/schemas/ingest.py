from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.body_metrics import BodyMetricCreate, BodyMetricRead
from app.schemas.common import OrmModel, require_non_empty, require_timezone_aware_utc
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


# --- Health Connect (HC Webhook app payload) ---------------------------------
# The JSON body the HC Webhook Android app POSTs (github.com/mcnaveen/
# health-connect-webhook, docs/webhook.md). Only the types this app stores are
# modelled; every other key in the payload (heart_rate, weight, ...) is ignored.


class _HcModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _HcInterval(_HcModel):
    start_time: datetime
    end_time: datetime

    @field_validator("start_time", "end_time")
    @classmethod
    def requires_timezone(cls, value: datetime) -> datetime:
        return require_timezone_aware_utc(value)


class HcSteps(_HcInterval):
    count: int = Field(ge=0, le=200_000)


class HcSleepStage(_HcInterval):
    # Health Connect's SleepSessionRecord.STAGE_TYPE_* integer, as a string.
    stage: str
    duration_seconds: int = Field(ge=0, le=86_400)


class HcSleep(_HcModel):
    session_end_time: datetime
    duration_seconds: int = Field(gt=0, le=86_400)
    stages: list[HcSleepStage] = Field(default_factory=list)

    @field_validator("session_end_time")
    @classmethod
    def requires_timezone(cls, value: datetime) -> datetime:
        return require_timezone_aware_utc(value)


class HcExercise(_HcInterval):
    # Health Connect's ExerciseSessionRecord.EXERCISE_TYPE_* integer, as a string.
    type: str
    title: str | None = Field(default=None, max_length=200)
    duration_seconds: int = Field(ge=0, le=86_400)
    distance_meters: float | None = Field(default=None, ge=0, le=1_000_000)


class HealthConnectPayload(_HcModel):
    steps: list[HcSteps] = Field(default_factory=list, max_length=5_000)
    sleep: list[HcSleep] = Field(default_factory=list, max_length=500)
    exercise: list[HcExercise] = Field(default_factory=list, max_length=500)


class HcTypeSummary(BaseModel):
    """`merged` counts records matched to an entry logged by hand (or by
    another source), which keeps its own row instead of gaining a duplicate."""

    created: int = 0
    updated: int = 0
    unchanged: int = 0
    merged: int = 0
    skipped: int = 0


class HealthConnectIngestResult(BaseModel):
    steps: HcTypeSummary
    sleep: HcTypeSummary
    exercise: HcTypeSummary
