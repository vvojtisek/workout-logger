import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import REAL, CheckConstraint, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, UTCDateTime, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.session_exercise import SessionExercise


class SetEntry(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "set_entries"
    __table_args__ = (
        UniqueConstraint("session_exercise_id", "set_number"),
        UniqueConstraint("client_operation_id"),
        CheckConstraint(
            "state IN ('planned', 'completed', 'skipped')",
            name="ck_set_entry_state",
        ),
        Index("ix_set_entries_exercise_set", "session_exercise_id", "set_number"),
    )

    session_exercise_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("session_exercises.id", ondelete="CASCADE"), nullable=False
    )
    set_number: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_kg: Mapped[float | None] = mapped_column(REAL, nullable=True)
    reps: Mapped[int] = mapped_column(Integer, nullable=False)
    rir: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Kind-specific fields: added_weight_kg/band_level for bodyweight exercises,
    # duration_seconds/distance_km/incline_percent for cardio, rpe as a strength
    # alternative to rir. Nullable and orthogonal to the exercise's kind so a
    # kind change never requires a data migration.
    added_weight_kg: Mapped[float | None] = mapped_column(REAL, nullable=True)
    band_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    distance_km: Mapped[float | None] = mapped_column(REAL, nullable=True)
    incline_percent: Mapped[float | None] = mapped_column(REAL, nullable=True)
    rpe: Mapped[int | None] = mapped_column(Integer, nullable=True)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="completed")
    completed_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, default=utcnow)
    client_operation_id: Mapped[str] = mapped_column(String(100), nullable=False)

    session_exercise: Mapped["SessionExercise"] = relationship(back_populates="set_entries")
