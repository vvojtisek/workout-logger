import uuid
from typing import TYPE_CHECKING

from sqlalchemy import JSON, REAL, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, UUIDPrimaryKeyMixin
from app.services.volume import DEFAULT_RULE, sets_volume_kg, total_reps

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
    # Per-set detail, one entry per set like reps_per_set. NULL for logs saved
    # before it existed or by clients that only send one weight; weight_kg is
    # then every set's weight. When present, weight_kg is its last value.
    weight_per_set: Mapped[list[float | None] | None] = mapped_column(JSON, nullable=True)
    rir_per_set: Mapped[list[int | None] | None] = mapped_column(JSON, nullable=True)
    rest_time_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)

    workout_log: Mapped["WorkoutLog"] = relationship(back_populates="exercises")

    # How volume is counted for this exercise. Not stored: the log keeps only the
    # name, and app.services.volume_rules fills this from the exercise
    # catalogue when the log is loaded.
    volume_rule = DEFAULT_RULE

    @property
    def is_unilateral(self) -> bool:
        return self.volume_rule.is_unilateral

    @property
    def equipment_load_mode(self) -> str:
        return self.volume_rule.equipment_load_mode

    @property
    def total_reps(self) -> int:
        return sum(total_reps(reps, self.volume_rule) for reps in self.reps_per_set)

    @property
    def volume_kg(self) -> float:
        # Older logs keep only one weight for the exercise; edited and newly
        # completed ones keep one per set.
        per_set = self.weight_per_set
        weights = per_set if per_set else [self.weight_kg] * len(self.reps_per_set)
        return sets_volume_kg(zip(weights, self.reps_per_set, strict=False), self.volume_rule)
