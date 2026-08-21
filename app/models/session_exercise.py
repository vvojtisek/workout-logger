import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    REAL,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.set_entry import SetEntry
    from app.models.workout_session import WorkoutSession


class SessionExercise(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "session_exercises"
    __table_args__ = (
        UniqueConstraint("session_id", "sort_order"),
        CheckConstraint(
            "status IN ('planned', 'completed', 'skipped')",
            name="ck_session_exercise_status",
        ),
        CheckConstraint(
            "suggestion_source IN ('plan', 'history')",
            name="ck_session_exercise_suggestion_source",
        ),
        Index("ix_session_exercises_session_order", "session_id", "sort_order"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    exercise_name: Mapped[str] = mapped_column(String(150), nullable=False)
    target_sets: Mapped[int] = mapped_column(Integer, nullable=False)
    target_reps_min: Mapped[int] = mapped_column(Integer, nullable=False)
    target_reps_max: Mapped[int] = mapped_column(Integer, nullable=False)
    target_weight_kg: Mapped[float | None] = mapped_column(REAL, nullable=True)
    rest_time_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    group_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    group_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    suggested_weight_kg: Mapped[float | None] = mapped_column(REAL, nullable=True)
    suggested_reps: Mapped[int] = mapped_column(Integer, nullable=False)
    suggestion_source: Mapped[str] = mapped_column(String(20), nullable=False, default="plan")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="planned")

    workout_session: Mapped["WorkoutSession"] = relationship(back_populates="exercises")
    set_entries: Mapped[list["SetEntry"]] = relationship(
        back_populates="session_exercise",
        cascade="all, delete-orphan",
        order_by="SetEntry.set_number",
    )
