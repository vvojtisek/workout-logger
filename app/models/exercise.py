import uuid

from sqlalchemy import JSON, Boolean, CheckConstraint, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class Exercise(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """The exercise catalogue. Plan exercises remain free-text snapshots; a
    plan exercise may optionally reference one of these, but deleting the
    catalogue entry never touches the plan (see `PlanExercise.catalog_exercise_id`,
    ON DELETE SET NULL)."""

    __tablename__ = "exercises"
    __table_args__ = (
        CheckConstraint(
            "equipment_load_mode IN ('standard', 'single_db', 'pair_db')",
            name="ck_exercises_equipment_load_mode",
        ),
        Index(
            "uq_exercises_owner_name",
            "owner_id",
            "name",
            unique=True,
            sqlite_where=text("owner_id IS NOT NULL"),
        ),
        Index(
            "uq_exercises_unowned_name",
            "name",
            unique=True,
            sqlite_where=text("owner_id IS NULL"),
        ),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_exercises_owner_id_users"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(150, collation="NOCASE"), nullable=False)
    aliases: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    media_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    primary_muscles: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    secondary_muscles: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    instructions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    equipment: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Alternatives: each inner list is one complete set of equipment tags
    # (see app/services/equipment.py). Empty means "not tagged".
    equipment_any_of: Mapped[list[list[str]]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    safety_notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    # How logged weight and reps become volume (see app/services/volume.py).
    # The typed weight is always one dumbbell; "pair_db" counts two of them.
    equipment_load_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, default="standard", server_default="standard"
    )
    # One logged set is the same reps on each side; reps and volume count twice.
    is_unilateral: Mapped[bool] = mapped_column(
        Boolean(), nullable=False, default=False, server_default="0"
    )
