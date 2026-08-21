"""Add workout exercise groups.

Revision ID: 8e2f78cce104
Revises: 3d62adf731c8
Create Date: 2026-08-22 01:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "8e2f78cce104"
down_revision: str | None = "3d62adf731c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table_name in ("plan_exercises", "session_exercises"):
        op.add_column(table_name, sa.Column("group_key", sa.String(length=100), nullable=True))
        op.add_column(table_name, sa.Column("group_order", sa.Integer(), nullable=True))


def downgrade() -> None:
    for table_name in ("session_exercises", "plan_exercises"):
        op.drop_column(table_name, "group_order")
        op.drop_column(table_name, "group_key")
