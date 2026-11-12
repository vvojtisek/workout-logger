"""Add gym-specific barbell plate profiles to locations.

Revision ID: a1b3c5d7e9f0
Revises: d7e2a5c9b1f4
Create Date: 2026-11-12 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1b3c5d7e9f0"
down_revision: str | None = "d7e2a5c9b1f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "locations",
        sa.Column("plate_profiles", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("locations", "plate_profiles")
