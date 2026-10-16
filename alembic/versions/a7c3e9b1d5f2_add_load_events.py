"""Add recurring load events (hockey games and practices).

Revision ID: a7c3e9b1d5f2
Revises: d2f6b8a4c1e7
Create Date: 2026-10-16 08:00:00

A new table only, so the previous release runs unchanged on this schema.
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "a7c3e9b1d5f2"
down_revision: str | None = "d2f6b8a4c1e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "load_events",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column(
            "owner_id",
            app.models.base.GUID(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_load_events_owner_id_users"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("season_start", sa.Date(), nullable=False),
        sa.Column("season_end", sa.Date(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('game', 'practice')", name="ck_load_events_kind"),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_load_events_weekday"),
        sa.CheckConstraint(
            "duration_minutes BETWEEN 15 AND 300", name="ck_load_events_duration_minutes"
        ),
        sa.CheckConstraint("season_end >= season_start", name="ck_load_events_season"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_load_events_owner_id", "load_events", ["owner_id"])


def downgrade() -> None:
    op.drop_table("load_events")
