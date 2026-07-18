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
    from app.models.workout_plan import WorkoutPlan


class PlanExercise(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "plan_exercises"
    __table_args__ = (
        UniqueConstraint("workout_plan_id", "sort_order"),
        CheckConstraint("target_reps_max >= target_reps_min", name="ck_plan_exercise_reps_range"),
        Index("ix_plan_exercises_plan_order", "workout_plan_id", "sort_order"),
    )

    workout_plan_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("workout_plans.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    exercise_name: Mapped[str] = mapped_column(String(150), nullable=False)
    target_sets: Mapped[int] = mapped_column(Integer, nullable=False)
    target_reps_min: Mapped[int] = mapped_column(Integer, nullable=False)
    target_reps_max: Mapped[int] = mapped_column(Integer, nullable=False)
    target_weight_kg: Mapped[float | None] = mapped_column(REAL, nullable=True)
    rest_time_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)

    workout_plan: Mapped["WorkoutPlan"] = relationship(back_populates="exercises")
