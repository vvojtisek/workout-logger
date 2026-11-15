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
        CheckConstraint(
            "exercise_kind IN ('strength', 'bodyweight', 'cardio')",
            name="ck_plan_exercises_kind",
        ),
        CheckConstraint(
            "target_rir IS NULL OR (exercise_kind = 'strength' AND target_rir >= 0 AND target_rir <= 10)",
            name="ck_plan_exercises_target_rir_range",
        ),
        Index("ix_plan_exercises_plan_order", "workout_plan_id", "sort_order"),
    )

    workout_plan_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("workout_plans.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    exercise_name: Mapped[str] = mapped_column(String(150), nullable=False)
    # A plan exercise is always a free-text snapshot; this optional link to the
    # catalogue is purely informational. ON DELETE SET NULL so removing a
    # catalogue entry never touches an existing plan.
    catalog_exercise_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("exercises.id", ondelete="SET NULL"), nullable=True
    )
    exercise_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="strength")
    target_sets: Mapped[int] = mapped_column(Integer, nullable=False)
    target_reps_min: Mapped[int] = mapped_column(Integer, nullable=False)
    target_reps_max: Mapped[int] = mapped_column(Integer, nullable=False)
    target_rir: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_weight_kg: Mapped[float | None] = mapped_column(REAL, nullable=True)
    rest_time_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    group_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    group_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_rpe: Mapped[int | None] = mapped_column(
        Integer,
        CheckConstraint(
            "target_rpe IS NULL OR (exercise_kind = 'strength' AND target_rpe BETWEEN 1 AND 10)",
            name="ck_plan_exercises_target_rpe_range",
        ),
        nullable=True,
    )
    # "coach": the targets were prescribed by an assistant and win over the
    # history-based suggestion when a session starts.
    target_source: Mapped[str] = mapped_column(
        String(10),
        CheckConstraint(
            "target_source IN ('user', 'coach')", name="ck_plan_exercises_target_source"
        ),
        nullable=False,
        default="user",
        server_default="user",
    )
    coach_rationale: Mapped[str | None] = mapped_column(String(240), nullable=True)

    workout_plan: Mapped["WorkoutPlan"] = relationship(back_populates="exercises")
