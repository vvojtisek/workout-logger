"""Allow an exercise-specific progression load increment.

Revision ID: c4d6e8f0a1b3
Revises: f2b4d6a8c0e1
Create Date: 2026-11-12 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4d6e8f0a1b3"
down_revision: str | None = "c3d5e7f9a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("exercises", sa.Column("progression_increment_kg", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("exercises", "progression_increment_kg")
