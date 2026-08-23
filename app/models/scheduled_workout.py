import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.program import Program
    from app.models.workout_plan import WorkoutPlan


class ScheduledWorkout(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A workout plan placed on the calendar for a specific date.

    `program_id` is optional: a workout can be scheduled ad hoc, without
    belonging to any program block. Deliberately no unique constraint on
    (owner, date): concurrent and overlapping programs may schedule several
    workouts on the same day.
    """

    __tablename__ = "scheduled_workouts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('scheduled', 'in_progress', 'completed', 'skipped')",
            name="ck_scheduled_workouts_status",
        ),
        Index("ix_scheduled_workouts_scheduled_date", "scheduled_date"),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    program_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("programs.id", ondelete="CASCADE"), nullable=True
    )
    workout_plan_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("workout_plans.id", ondelete="CASCADE"), nullable=False
    )
    scheduled_date: Mapped[date] = mapped_column(Date(), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")
    workout_session_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("workout_sessions.id", ondelete="SET NULL"), nullable=True, unique=True
    )

    program: Mapped["Program | None"] = relationship(back_populates="scheduled_workouts")
    workout_plan: Mapped["WorkoutPlan"] = relationship()

    @property
    def workout_plan_name(self) -> str:
        return self.workout_plan.name

    @property
    def program_name(self) -> str | None:
        return self.program.name if self.program is not None else None
