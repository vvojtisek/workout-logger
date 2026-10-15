"""Add notes to scheduled workouts.

Revision ID: d8f2a4c6e1b3
Revises: c5e1b8f3a6d2
Create Date: 2026-10-15 14:00:00

Carries a per-session instruction, such as a program template's week-by-week
load change, on the calendar entry itself. Nullable, so existing rows are
unchanged.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d8f2a4c6e1b3"
down_revision: str | None = "c5e1b8f3a6d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("scheduled_workouts") as batch_op:
        batch_op.add_column(sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("scheduled_workouts") as batch_op:
        batch_op.drop_column("notes")
