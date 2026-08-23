"""Add sleep entries.

Revision ID: 4ce075343442
Revises: 6290bdbe0ab7
Create Date: 2026-08-23 07:15:07
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "4ce075343442"
down_revision: str | None = "6290bdbe0ab7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sleep_entries",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("sleep_start", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("sleep_end", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(length=50), nullable=False),
        sa.Column("time_in_bed_seconds", sa.Integer(), nullable=False),
        sa.Column("estimated_sleep_seconds", sa.Integer(), nullable=True),
        sa.Column("awake_seconds", sa.Integer(), nullable=True),
        sa.Column("quality_score", sa.Integer(), nullable=True),
        sa.Column("resting_heart_rate", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "quality_score IS NULL OR (quality_score >= 1 AND quality_score <= 5)",
            name="ck_sleep_entries_quality_score",
        ),
        sa.CheckConstraint("sleep_end > sleep_start", name="ck_sleep_entries_end_after_start"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sleep_entries_sleep_end", "sleep_entries", ["sleep_end"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_sleep_entries_sleep_end", table_name="sleep_entries")
    op.drop_table("sleep_entries")
