import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class StepCount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A daily step-count total ingested from an external source. Only ever
    written by /api/v1/ingest/steps; there is no manual-entry path."""

    __tablename__ = "step_counts"
    __table_args__ = (
        CheckConstraint("steps >= 0", name="ck_step_counts_steps_non_negative"),
        # NULL external_id would never collide, but every row here is ingested
        # (external_id is required by the ingest schema), so this constraint
        # alone is what makes a re-sync idempotent.
        UniqueConstraint("source", "external_id", name="uq_step_counts_source_external_id"),
    )

    # Nullable and unenforced by any FK: there is no users table yet. Carrying
    # this column now makes the future multi-user migration additive.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    recorded_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    steps: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
