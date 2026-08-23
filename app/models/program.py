import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.scheduled_workout import ScheduledWorkout


class Program(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A named date-range block (e.g. 'Hockey Pre-Season', 'Hypertrophy').

    Deliberately no unique constraint on (owner, date range): overlapping and
    concurrent programs are allowed by design.
    """

    __tablename__ = "programs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'completed', 'archived')",
            name="ck_programs_status",
        ),
        CheckConstraint(
            "end_date IS NULL OR end_date >= start_date",
            name="ck_programs_date_range",
        ),
    )

    # Nullable and unenforced by any FK: there is no users table yet. Carrying
    # this column now makes the future multi-user migration additive.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    kind: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[date] = mapped_column(Date(), nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)

    scheduled_workouts: Mapped[list["ScheduledWorkout"]] = relationship(
        back_populates="program",
        cascade="all, delete-orphan",
        order_by="ScheduledWorkout.scheduled_date",
    )
