import uuid
from datetime import date, datetime

from sqlalchemy import (
    REAL,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin, utcnow


class SupplementSchedule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One supplement in the daily protocol. Replacing the stack deactivates
    entries that are no longer in it, so the intake history stays."""

    __tablename__ = "supplement_schedules"
    __table_args__ = (
        CheckConstraint(
            "timing IN ('morning', 'pre_workout', 'post_workout', 'with_meal', 'evening', "
            "'bedtime')",
            name="ck_supplement_schedules_timing",
        ),
        CheckConstraint(
            "applies_on IN ('daily', 'training_days', 'rest_days', 'hockey_days')",
            name="ck_supplement_schedules_applies_on",
        ),
        CheckConstraint("dose > 0", name="ck_supplement_schedules_dose"),
        Index("ix_supplement_schedules_owner_active", "owner_id", "active"),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_supplement_schedules_owner_id_users"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    dose: Mapped[float] = mapped_column(REAL, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    timing: Mapped[str] = mapped_column(String(20), nullable=False)
    applies_on: Mapped[str] = mapped_column(String(20), nullable=False, default="daily")
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    intakes: Mapped[list["SupplementIntake"]] = relationship(
        back_populates="schedule", cascade="all, delete-orphan"
    )


class SupplementIntake(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "supplement_intakes"
    __table_args__ = (UniqueConstraint("schedule_id", "intake_date"),)

    schedule_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("supplement_schedules.id", ondelete="CASCADE"), nullable=False
    )
    intake_date: Mapped[date] = mapped_column(Date(), nullable=False)
    taken_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utcnow)
    schedule: Mapped["SupplementSchedule"] = relationship(back_populates="intakes")
