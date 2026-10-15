import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.exercise_log import ExerciseLog


class WorkoutLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "workout_logs"
    __table_args__ = (
        CheckConstraint(
            "activity_type IS NULL OR activity_type IN "
            "('ice_hockey', 'swimming', 'cycling', 'hiking', 'running', 'other')",
            name="ck_workout_logs_activity_type",
        ),
        CheckConstraint(
            "effort_rpe IS NULL OR effort_rpe BETWEEN 1 AND 10", name="ck_workout_logs_effort_rpe"
        ),
        CheckConstraint(
            "distance_km IS NULL OR distance_km >= 0", name="ck_workout_logs_distance_km"
        ),
        Index("ix_workout_logs_performed_at", "performed_at"),
        Index("ix_workout_logs_source_plan_id", "source_plan_id"),
        Index(
            "uq_workout_logs_owner_source_external_id",
            "owner_id",
            "source",
            "external_id",
            unique=True,
            sqlite_where=text("owner_id IS NOT NULL"),
        ),
        Index(
            "uq_workout_logs_unowned_source_external_id",
            "source",
            "external_id",
            unique=True,
            sqlite_where=text("owner_id IS NULL"),
        ),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_workout_logs_owner_id_users"),
        nullable=True,
        index=True,
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
    # Set for a non-gym session (hockey, a swim, a ride); NULL for a strength workout.
    activity_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Session RPE on the CR-10 scale; times duration it gives the session's training load.
    effort_rpe: Mapped[int | None] = mapped_column(Integer, nullable=True)

    exercises: Mapped[list["ExerciseLog"]] = relationship(
        back_populates="workout_log",
        cascade="all, delete-orphan",
        order_by="ExerciseLog.sort_order",
    )
