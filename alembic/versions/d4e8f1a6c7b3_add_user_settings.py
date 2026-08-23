"""Add user settings.

Revision ID: d4e8f1a6c7b3
Revises: b3f7a2c9e5d1
Create Date: 2026-08-23 16:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "d4e8f1a6c7b3"
down_revision: str | None = "b3f7a2c9e5d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("units", sa.String(length=10), nullable=False),
        sa.Column("default_rest_compound_seconds", sa.Integer(), nullable=False),
        sa.Column("default_rest_isolation_seconds", sa.Integer(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint("units IN ('metric', 'imperial')", name="ck_user_settings_units"),
        sa.CheckConstraint(
            "default_rest_compound_seconds >= 0 AND default_rest_compound_seconds <= 3600",
            name="ck_user_settings_rest_compound_range",
        ),
        sa.CheckConstraint(
            "default_rest_isolation_seconds >= 0 AND default_rest_isolation_seconds <= 3600",
            name="ck_user_settings_rest_isolation_range",
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("user_settings")
