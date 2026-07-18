from typing import TYPE_CHECKING

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.plan_exercise import PlanExercise


class WorkoutPlan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "workout_plans"

    name: Mapped[str] = mapped_column(String(120, collation="NOCASE"), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)

    exercises: Mapped[list["PlanExercise"]] = relationship(
        back_populates="workout_plan",
        cascade="all, delete-orphan",
        order_by="PlanExercise.sort_order",
    )
