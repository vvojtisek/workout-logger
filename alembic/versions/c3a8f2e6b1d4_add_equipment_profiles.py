"""Allow settings and workouts to switch between bar and plate profiles.

Revision ID: c3a8f2e6b1d4
Revises: b1d7e3f5a9c2
Create Date: 2026-11-12 13:00:00
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c3a8f2e6b1d4"
down_revision: str | None = "b1d7e3f5a9c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

DEFAULT_INVENTORY = [
    {"plate_weight_kg": weight, "pairs": 4}
    for weight in (25.0, 20.0, 15.0, 10.0, 5.0, 2.5, 1.25, 0.5, 0.25)
]
DEFAULT_PROFILES = json.dumps(
    [
        {
            "id": "barbell-default",
            "name": "Barbell 20 kg",
            "barbell_weight_kg": 20,
            "plate_inventory": DEFAULT_INVENTORY,
        }
    ],
    separators=(",", ":"),
)


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("equipment_profiles", sa.JSON(), nullable=False, server_default=DEFAULT_PROFILES),
    )
    op.add_column(
        "user_settings",
        sa.Column(
            "active_equipment_profile_id",
            sa.String(length=64),
            nullable=False,
            server_default="barbell-default",
        ),
    )

    connection = op.get_bind()
    existing = connection.execute(
        sa.text("SELECT id, barbell_weight_kg, plate_inventory FROM user_settings")
    ).all()
    for row in existing:
        inventory = row.plate_inventory
        if isinstance(inventory, str):
            inventory = json.loads(inventory)
        weight = float(row.barbell_weight_kg)
        profile = [
            {
                "id": "barbell-default",
                "name": f"Barbell {weight:g} kg",
                "barbell_weight_kg": weight,
                "plate_inventory": inventory,
            }
        ]
        connection.execute(
            sa.text(
                "UPDATE user_settings SET equipment_profiles = :profiles, "
                "active_equipment_profile_id = 'barbell-default' WHERE id = :id"
            ),
            {"id": row.id, "profiles": json.dumps(profile, separators=(",", ":"))},
        )


def downgrade() -> None:
    op.drop_column("user_settings", "active_equipment_profile_id")
    op.drop_column("user_settings", "equipment_profiles")
