import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, UTCDateTime, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.session_exercise import SessionExercise


class WorkoutSession(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "workout_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'completed', 'cancelled')",
            name="ck_workout_session_status",
        ),
        Index(
            "uq_workout_sessions_active_plan",
            "source_plan_id",
            unique=True,
            sqlite_where=text("status = 'active'"),
        ),
        Index("ix_workout_sessions_status_started", "status", "started_at"),
    )

    source_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("workout_plans.id", ondelete="SET NULL"), nullable=True
    )
    source_plan_name: Mapped[str] = mapped_column(String(120), nullable=False)
    workout_log_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("workout_logs.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    focused_exercise_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    focused_set_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    rest_ends_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    exercises: Mapped[list["SessionExercise"]] = relationship(
        back_populates="workout_session",
        cascade="all, delete-orphan",
        order_by="SessionExercise.sort_order",
    )
