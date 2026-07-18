import uuid
from typing import TYPE_CHECKING

from sqlalchemy import JSON, REAL, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.workout_log import WorkoutLog


class ExerciseLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "exercise_logs"
    __table_args__ = (
        UniqueConstraint("workout_log_id", "sort_order"),
        Index("ix_exercise_logs_log_order", "workout_log_id", "sort_order"),
    )

    workout_log_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("workout_logs.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    exercise_name: Mapped[str] = mapped_column(String(150), nullable=False)
    sets_count: Mapped[int] = mapped_column(Integer, nullable=False)
    reps_per_set: Mapped[list[int]] = mapped_column(JSON, nullable=False)
    weight_kg: Mapped[float | None] = mapped_column(REAL, nullable=True)
    rest_time_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)

    workout_log: Mapped["WorkoutLog"] = relationship(back_populates="exercises")
