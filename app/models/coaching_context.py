import uuid

from sqlalchemy import CheckConstraint, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class CoachingContext(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Singleton two-tier portable coaching context shared across AI clients.

    Tier 1 (`athlete_profile_md`, <= 8,192 UTF-8 bytes) holds durable athlete
    goals, injuries, and guardrails and is editable via the PWA/REST API only.
    Tier 2 (`working_notes_md`, <= 4,096 UTF-8 bytes) holds short-lived active
    coaching adjustments and is updatable by AI clients over MCP.
    """

    __tablename__ = "coaching_context"
    __table_args__ = (
        UniqueConstraint("singleton_key", name="uq_coaching_context_singleton_key"),
        CheckConstraint("profile_version >= 1", name="ck_coaching_context_profile_version"),
        CheckConstraint("notes_version >= 1", name="ck_coaching_context_notes_version"),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    singleton_key: Mapped[str] = mapped_column(
        String(20), nullable=False, default="default", server_default="default"
    )
    athlete_profile_md: Mapped[str | None] = mapped_column(Text(), nullable=True)
    working_notes_md: Mapped[str | None] = mapped_column(Text(), nullable=True)
    profile_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    notes_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    previous_profile_md: Mapped[str | None] = mapped_column(Text(), nullable=True)
    previous_notes_md: Mapped[str | None] = mapped_column(Text(), nullable=True)

    @property
    def has_previous_profile(self) -> bool:
        return self.previous_profile_md is not None

    @property
    def has_previous_notes(self) -> bool:
        return self.previous_notes_md is not None
