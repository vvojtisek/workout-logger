import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class StepCount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A daily step-count total ingested from an external source. Only ever
    written by /api/v1/ingest/steps; there is no manual-entry path."""

    __tablename__ = "step_counts"
    __table_args__ = (
        CheckConstraint("steps >= 0", name="ck_step_counts_steps_non_negative"),
        Index(
            "uq_step_counts_owner_source_external_id",
            "owner_id",
            "source",
            "external_id",
            unique=True,
            sqlite_where=text("owner_id IS NOT NULL"),
        ),
        Index(
            "uq_step_counts_unowned_source_external_id",
            "source",
            "external_id",
            unique=True,
            sqlite_where=text("owner_id IS NULL"),
        ),
    )

    # Nullable and unenforced by any FK: there is no users table yet. Carrying
    # this column now makes the future multi-user migration additive.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    recorded_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    steps: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
