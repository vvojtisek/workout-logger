"""Add body metrics.

Revision ID: 4e263e1811d8
Revises: 81f5b00da187
Create Date: 2026-08-23 06:15:42
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "4e263e1811d8"
down_revision: str | None = "81f5b00da187"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "body_metrics",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("measured_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("weight_kg", sa.REAL(), nullable=False),
        sa.Column("body_fat_percent", sa.REAL(), nullable=True),
        sa.Column("neck_cm", sa.REAL(), nullable=True),
        sa.Column("chest_cm", sa.REAL(), nullable=True),
        sa.Column("waist_cm", sa.REAL(), nullable=True),
        sa.Column("hips_cm", sa.REAL(), nullable=True),
        sa.Column("biceps_cm", sa.REAL(), nullable=True),
        sa.Column("forearms_cm", sa.REAL(), nullable=True),
        sa.Column("thighs_cm", sa.REAL(), nullable=True),
        sa.Column("calves_cm", sa.REAL(), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_body_metrics_measured_at", "body_metrics", ["measured_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_body_metrics_measured_at", table_name="body_metrics")
    op.drop_table("body_metrics")
