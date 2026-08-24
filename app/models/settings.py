import uuid

from sqlalchemy import CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserSettings(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Preferences that shape how the GUI displays and pre-fills data. There
    is exactly one row per owner; `app/services/settings.py` gets-or-creates
    it with defaults rather than requiring a setup step."""

    __tablename__ = "user_settings"
    __table_args__ = (
        CheckConstraint("units IN ('metric', 'imperial')", name="ck_user_settings_units"),
        CheckConstraint(
            "default_rest_compound_seconds >= 0 AND default_rest_compound_seconds <= 3600",
            name="ck_user_settings_rest_compound_range",
        ),
        CheckConstraint(
            "default_rest_isolation_seconds >= 0 AND default_rest_isolation_seconds <= 3600",
            name="ck_user_settings_rest_isolation_range",
        ),
    )

    # Nullable and unenforced by any FK: there is no users table yet. Carrying
    # this column now makes the future multi-user migration additive.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    units: Mapped[str] = mapped_column(String(10), nullable=False, default="metric")
    # Pre-fills the rest-time field when a plan author adds a compound vs. an
    # isolation exercise; never enforced or stored against the exercise itself.
    default_rest_compound_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    default_rest_isolation_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
