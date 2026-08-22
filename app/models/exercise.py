from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Exercise(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """The exercise catalogue. Plan exercises remain free-text snapshots; a
    plan exercise may optionally reference one of these, but deleting the
    catalogue entry never touches the plan (see `PlanExercise.catalog_exercise_id`,
    ON DELETE SET NULL)."""

    __tablename__ = "exercises"

    name: Mapped[str] = mapped_column(String(150, collation="NOCASE"), nullable=False, unique=True)
    aliases: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    media_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    primary_muscles: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    secondary_muscles: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    instructions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    equipment: Mapped[str | None] = mapped_column(String(200), nullable=True)
    safety_notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
