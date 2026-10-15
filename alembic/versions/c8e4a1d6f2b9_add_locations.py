"""Add training locations.

Revision ID: c8e4a1d6f2b9
Revises: b5d7e2f9a3c1
Create Date: 2026-10-15 21:30:00

A new table only, so the previous release runs unchanged on this schema.
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "c8e4a1d6f2b9"
down_revision: str | None = "b5d7e2f9a3c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "locations",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column(
            "owner_id",
            app.models.base.GUID(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_locations_owner_id_users"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=100, collation="NOCASE"), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("equipment", sa.JSON(), nullable=False),
        sa.Column("default_minutes", sa.Integer(), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('home', 'office', 'gym', 'travel')", name="ck_locations_kind"),
        sa.CheckConstraint(
            "default_minutes IS NULL OR default_minutes BETWEEN 5 AND 240",
            name="ck_locations_default_minutes",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_locations_owner_id", "locations", ["owner_id"])
    op.create_index(
        "uq_locations_owner_name",
        "locations",
        ["owner_id", "name"],
        unique=True,
        sqlite_where=sa.text("owner_id IS NOT NULL"),
    )
    op.create_index(
        "uq_locations_unowned_name",
        "locations",
        ["name"],
        unique=True,
        sqlite_where=sa.text("owner_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_table("locations")
