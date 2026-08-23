import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import CheckConstraint, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin


class SleepEntry(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A manually logged sleep summary. `time_in_bed_seconds` is always
    derived from `sleep_end - sleep_start`, never a separate input."""

    __tablename__ = "sleep_entries"
    __table_args__ = (
        CheckConstraint("sleep_end > sleep_start", name="ck_sleep_entries_end_after_start"),
        CheckConstraint(
            "quality_score IS NULL OR (quality_score >= 1 AND quality_score <= 5)",
            name="ck_sleep_entries_quality_score",
        ),
        # NULL external_id (every manually-logged entry) is never considered a
        # duplicate of another NULL; only two ingested rows sharing the same
        # source+external_id collide, which is what makes a re-sync idempotent.
        UniqueConstraint("source", "external_id", name="uq_sleep_entries_source_external_id"),
    )

    # Nullable and unenforced by any FK: there is no users table yet. Carrying
    # this column now makes the future multi-user migration additive.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    sleep_start: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    sleep_end: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, index=True)
    # The IANA zone the sleeper was in, used to attribute an overnight entry
    # to the calendar day they woke up on (see `sleep_date`).
    timezone: Mapped[str] = mapped_column(String(50), nullable=False)
    time_in_bed_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_sleep_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    awake_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quality_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resting_heart_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")
    # Set only by /api/v1/ingest/sleep: the sync source's own record id, used
    # to make a re-sync idempotent rather than a signal a human ever reads.
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)

    @property
    def sleep_date(self) -> date:
        return self.sleep_end.astimezone(ZoneInfo(self.timezone)).date()
