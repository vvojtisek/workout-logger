"""Add the coaching principles text.

Revision ID: c2e4a6b8d0f1
Revises: b9d1f3a5c7e2
Create Date: 2026-10-16 10:00:00

A new table only, so the previous release runs unchanged on this schema.
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "c2e4a6b8d0f1"
down_revision: str | None = "b9d1f3a5c7e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "coaching_principles",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("coaching_principles")
