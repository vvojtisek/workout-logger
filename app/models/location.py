import uuid

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class Location(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A place to train (office, gym, home) and the equipment it has, as tags
    from `app/services/equipment.py`. Bodyweight is implied and not stored."""

    __tablename__ = "locations"
    __table_args__ = (
        Index(
            "uq_locations_owner_name",
            "owner_id",
            "name",
            unique=True,
            sqlite_where=text("owner_id IS NOT NULL"),
        ),
        Index(
            "uq_locations_unowned_name",
            "name",
            unique=True,
            sqlite_where=text("owner_id IS NULL"),
        ),
        CheckConstraint(
            "kind IN ('home', 'office', 'gym', 'travel')",
            name="ck_locations_kind",
        ),
        CheckConstraint(
            "default_minutes IS NULL OR default_minutes BETWEEN 5 AND 240",
            name="ck_locations_default_minutes",
        ),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_locations_owner_id_users"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100, collation="NOCASE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    equipment: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    default_minutes: Mapped[int | None] = mapped_column(Integer(), nullable=True)
