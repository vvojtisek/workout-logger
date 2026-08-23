import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.exercise_log import ExerciseLog


class WorkoutLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "workout_logs"
    __table_args__ = (
        Index("ix_workout_logs_performed_at", "performed_at"),
        Index("ix_workout_logs_source_plan_id", "source_plan_id"),
        # NULL external_id (every manually-logged entry) is never considered a
        # duplicate of another NULL; only two ingested rows sharing the same
        # source+external_id collide, which is what makes a re-sync idempotent.
        UniqueConstraint("source", "external_id", name="uq_workout_logs_source_external_id"),
    )

    source_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("workout_plans.id", ondelete="SET NULL"), nullable=True
    )
    source_plan_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    performed_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    total_time_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    calories_burned: Mapped[int | None] = mapped_column(Integer, nullable=True)
    overall_feeling: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")
    # Set only by /api/v1/ingest/sessions: the sync source's own record id,
    # used to make a re-sync idempotent rather than a signal a human ever reads.
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)

    exercises: Mapped[list["ExerciseLog"]] = relationship(
        back_populates="workout_log",
        cascade="all, delete-orphan",
        order_by="ExerciseLog.sort_order",
    )
