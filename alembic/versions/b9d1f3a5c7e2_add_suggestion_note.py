"""Add the progression note to session exercises.

Revision ID: b9d1f3a5c7e2
Revises: a7c3e9b1d5f2
Create Date: 2026-10-16 09:00:00

A nullable column only, so the previous release runs unchanged on this schema.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b9d1f3a5c7e2"
down_revision: str | None = "a7c3e9b1d5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("session_exercises") as batch_op:
        batch_op.add_column(sa.Column("suggestion_note", sa.String(length=120), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("session_exercises") as batch_op:
        batch_op.drop_column("suggestion_note")
