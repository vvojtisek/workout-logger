import uuid

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class AthleteProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Who the coach is planning for: goals, hard dietary exclusions and
    standing physical constraints. One row per owner. Assistants read it in
    the coaching context but cannot write it (see ARCHITECTURE_PLAN.md D11)."""

    __tablename__ = "athlete_profiles"
    __table_args__ = (
        Index(
            "uq_athlete_profiles_owner",
            "owner_id",
            unique=True,
            sqlite_where=text("owner_id IS NOT NULL"),
        ),
        CheckConstraint(
            "birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100",
            name="ck_athlete_profiles_birth_year",
        ),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_athlete_profiles_owner_id_users"),
        nullable=True,
    )
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    longevity_goals: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    # [{"item", "kind", "severity", "note"}], validated by app/schemas/athlete_profile.py.
    dietary_constraints: Mapped[list[dict[str, str | None]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    physical_constraints: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
