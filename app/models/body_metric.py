import uuid
from datetime import datetime

from sqlalchemy import REAL
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin


class BodyMetric(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A single biometric measurement. Rolling 7- and 14-day deltas are
    computed at query time by the trends service, never stored here."""

    __tablename__ = "body_metrics"

    # Nullable and unenforced by any FK: there is no users table yet. Carrying
    # this column now makes the future multi-user migration additive.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    measured_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, index=True)
    weight_kg: Mapped[float] = mapped_column(REAL, nullable=False)
    body_fat_percent: Mapped[float | None] = mapped_column(REAL, nullable=True)
    neck_cm: Mapped[float | None] = mapped_column(REAL, nullable=True)
    chest_cm: Mapped[float | None] = mapped_column(REAL, nullable=True)
    waist_cm: Mapped[float | None] = mapped_column(REAL, nullable=True)
    hips_cm: Mapped[float | None] = mapped_column(REAL, nullable=True)
    biceps_cm: Mapped[float | None] = mapped_column(REAL, nullable=True)
    forearms_cm: Mapped[float | None] = mapped_column(REAL, nullable=True)
    thighs_cm: Mapped[float | None] = mapped_column(REAL, nullable=True)
    calves_cm: Mapped[float | None] = mapped_column(REAL, nullable=True)
