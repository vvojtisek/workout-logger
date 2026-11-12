import uuid

from sqlalchemy import JSON, CheckConstraint, Float, Integer, String
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
    barbell_weight_kg: Mapped[float] = mapped_column(
        Float, nullable=False, default=20.0, server_default="20"
    )
    plate_inventory: Mapped[list[dict[str, float | int]]] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: [
            {"plate_weight_kg": weight, "pairs": 4}
            for weight in (25.0, 20.0, 15.0, 10.0, 5.0, 2.5, 1.25, 0.5, 0.25)
        ],
        server_default=(
            '[{"plate_weight_kg":25.0,"pairs":4},{"plate_weight_kg":20.0,"pairs":4},'
            '{"plate_weight_kg":15.0,"pairs":4},{"plate_weight_kg":10.0,"pairs":4},'
            '{"plate_weight_kg":5.0,"pairs":4},{"plate_weight_kg":2.5,"pairs":4},'
            '{"plate_weight_kg":1.25,"pairs":4},{"plate_weight_kg":0.5,"pairs":4},'
            '{"plate_weight_kg":0.25,"pairs":4}]'
        ),
    )
    equipment_profiles: Mapped[list[dict[str, object]]] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: [
            {
                "id": "barbell-default",
                "name": "Barbell 20 kg",
                "barbell_weight_kg": 20,
                "plate_inventory": [
                    {"plate_weight_kg": weight, "pairs": 4}
                    for weight in (25.0, 20.0, 15.0, 10.0, 5.0, 2.5, 1.25, 0.5, 0.25)
                ],
            }
        ],
        server_default=(
            '[{"id":"barbell-default","name":"Barbell 20 kg","barbell_weight_kg":20,'
            '"plate_inventory":[{"plate_weight_kg":25.0,"pairs":4},'
            '{"plate_weight_kg":20.0,"pairs":4},{"plate_weight_kg":15.0,"pairs":4},'
            '{"plate_weight_kg":10.0,"pairs":4},{"plate_weight_kg":5.0,"pairs":4},'
            '{"plate_weight_kg":2.5,"pairs":4},{"plate_weight_kg":1.25,"pairs":4},'
            '{"plate_weight_kg":0.5,"pairs":4},{"plate_weight_kg":0.25,"pairs":4}]}]'
        ),
    )
    active_equipment_profile_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default="barbell-default", server_default="barbell-default"
    )
