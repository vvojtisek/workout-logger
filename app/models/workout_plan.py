import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.plan_exercise import PlanExercise


class WorkoutPlan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "workout_plans"
    __table_args__ = (
        Index(
            "uq_workout_plans_owner_name",
            "owner_id",
            "name",
            unique=True,
            sqlite_where=text("owner_id IS NOT NULL"),
        ),
        Index(
            "uq_workout_plans_unowned_name",
            "name",
            unique=True,
            sqlite_where=text("owner_id IS NULL"),
        ),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_workout_plans_owner_id_users"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120, collation="NOCASE"), nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    # Set when a ready-made program created this plan; removing that program removes the plan.
    program_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("programs.id", ondelete="SET NULL", name="fk_workout_plans_program_id_programs"),
        nullable=True,
        index=True,
    )

    exercises: Mapped[list["PlanExercise"]] = relationship(
        back_populates="workout_plan",
        cascade="all, delete-orphan",
        order_by="PlanExercise.sort_order",
    )
