"""Add nutrition core.

Revision ID: 6290bdbe0ab7
Revises: 4e263e1811d8
Create Date: 2026-08-23 06:42:53
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "6290bdbe0ab7"
down_revision: str | None = "4e263e1811d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "foods",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("brand", sa.String(length=150), nullable=True),
        sa.Column("serving_quantity", sa.REAL(), nullable=False),
        sa.Column("serving_unit", sa.String(length=30), nullable=False),
        sa.Column("energy_kcal", sa.REAL(), nullable=False),
        sa.Column("protein_g", sa.REAL(), nullable=False),
        sa.Column("carbohydrate_g", sa.REAL(), nullable=False),
        sa.Column("fat_g", sa.REAL(), nullable=False),
        sa.Column("fiber_g", sa.REAL(), nullable=True),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "meal_entries",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("consumed_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("meal_type", sa.String(length=20), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')",
            name="ck_meal_entries_type",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meal_entries_consumed_at", "meal_entries", ["consumed_at"], unique=False)
    op.create_table(
        "nutrition_plans",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("energy_target_kcal", sa.REAL(), nullable=False),
        sa.Column("protein_target_g", sa.REAL(), nullable=False),
        sa.Column("carbohydrate_target_g", sa.REAL(), nullable=False),
        sa.Column("fat_target_g", sa.REAL(), nullable=False),
        sa.Column("fiber_target_g", sa.REAL(), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "valid_to IS NULL OR valid_to >= valid_from", name="ck_nutrition_plans_date_range"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "meal_items",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("meal_entry_id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("food_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("food_name_snapshot", sa.String(length=200), nullable=False),
        sa.Column("quantity", sa.REAL(), nullable=False),
        sa.Column("unit", sa.String(length=30), nullable=False),
        sa.Column("energy_kcal_snapshot", sa.REAL(), nullable=False),
        sa.Column("protein_g_snapshot", sa.REAL(), nullable=False),
        sa.Column("carbohydrate_g_snapshot", sa.REAL(), nullable=False),
        sa.Column("fat_g_snapshot", sa.REAL(), nullable=False),
        sa.Column("fiber_g_snapshot", sa.REAL(), nullable=True),
        sa.ForeignKeyConstraint(["food_id"], ["foods.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["meal_entry_id"], ["meal_entries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("meal_items")
    op.drop_table("nutrition_plans")
    op.drop_index("ix_meal_entries_consumed_at", table_name="meal_entries")
    op.drop_table("meal_entries")
    op.drop_table("foods")
