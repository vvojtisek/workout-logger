"""Add a configurable barbell and plate inventory to user settings.

Revision ID: a9c6e2f1b4d8
Revises: a7e3c9f1b5d2
Create Date: 2026-11-12 08:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a9c6e2f1b4d8"
down_revision: str | None = "a7e3c9f1b5d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

DEFAULT_PLATE_INVENTORY = (
    '[{"plate_weight_kg":25.0,"pairs":4},{"plate_weight_kg":20.0,"pairs":4},'
    '{"plate_weight_kg":15.0,"pairs":4},{"plate_weight_kg":10.0,"pairs":4},'
    '{"plate_weight_kg":5.0,"pairs":4},{"plate_weight_kg":2.5,"pairs":4},'
    '{"plate_weight_kg":1.25,"pairs":4},{"plate_weight_kg":0.5,"pairs":4},'
    '{"plate_weight_kg":0.25,"pairs":4}]'
)


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("barbell_weight_kg", sa.Float(), nullable=False, server_default="20"),
    )
    op.add_column(
        "user_settings",
        sa.Column(
            "plate_inventory",
            sa.JSON(),
            nullable=False,
            server_default=DEFAULT_PLATE_INVENTORY,
        ),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "plate_inventory")
    op.drop_column("user_settings", "barbell_weight_kg")
