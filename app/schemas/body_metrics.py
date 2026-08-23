from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import OrmModel, PaginatedResponse, require_timezone_aware_utc


class BodyMetricCreate(BaseModel):
    measured_at: datetime
    weight_kg: float = Field(gt=0, le=500)
    body_fat_percent: float | None = Field(default=None, ge=0, le=100)
    neck_cm: float | None = Field(default=None, gt=0, le=200)
    chest_cm: float | None = Field(default=None, gt=0, le=300)
    waist_cm: float | None = Field(default=None, gt=0, le=300)
    hips_cm: float | None = Field(default=None, gt=0, le=300)
    biceps_cm: float | None = Field(default=None, gt=0, le=200)
    forearms_cm: float | None = Field(default=None, gt=0, le=200)
    thighs_cm: float | None = Field(default=None, gt=0, le=200)
    calves_cm: float | None = Field(default=None, gt=0, le=200)

    @field_validator("measured_at")
    @classmethod
    def measured_at_requires_timezone(cls, value: datetime) -> datetime:
        return require_timezone_aware_utc(value)


class BodyMetricReplace(BodyMetricCreate):
    pass


class BodyMetricRead(OrmModel):
    id: UUID
    measured_at: datetime
    weight_kg: float
    body_fat_percent: float | None
    neck_cm: float | None
    chest_cm: float | None
    waist_cm: float | None
    hips_cm: float | None
    biceps_cm: float | None
    forearms_cm: float | None
    thighs_cm: float | None
    calves_cm: float | None
    created_at: datetime
    updated_at: datetime


class PaginatedBodyMetricsResponse(PaginatedResponse[BodyMetricRead]):
    pass


class BodyMetricTrends(BaseModel):
    latest: BodyMetricRead | None
    weight_kg_delta_7d: float | None
    weight_kg_delta_14d: float | None
    body_fat_percent_delta_7d: float | None
    body_fat_percent_delta_14d: float | None
