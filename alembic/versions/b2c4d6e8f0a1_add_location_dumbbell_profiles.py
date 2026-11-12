"""Add adjustable dumbbell profiles to locations.

Revision ID: b2c4d6e8f0a1
Revises: a1b3c5d7e9f0
Create Date: 2026-11-12 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b2c4d6e8f0a1"
down_revision: str | None = "a1b3c5d7e9f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "locations",
        sa.Column("dumbbell_profiles", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("locations", "dumbbell_profiles")
