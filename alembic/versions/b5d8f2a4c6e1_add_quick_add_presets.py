"""Add quick-add drink presets.

Revision ID: b5d8f2a4c6e1
Revises: a7c3e9f1b2d4
Create Date: 2026-10-19

One-tap drinks for the food logger, with values for the whole serving.
Cappuccino (about 150 ml whole milk, about 90 kcal) and unsweetened Tea
(0 kcal) are inserted as editable defaults; deleting one later is final,
because this revision never runs again.
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "b5d8f2a4c6e1"
down_revision: str | None = "a7c3e9f1b2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_PRESETS = (
    {
        "name": "Cappuccino",
        "quantity": 150.0,
        "unit": "ml",
        "energy_kcal": 90.0,
        "protein_g": 5.0,
        "carbohydrate_g": 7.2,
        "fat_g": 4.5,
        "position": 0,
    },
    {
        "name": "Tea",
        "quantity": 250.0,
        "unit": "ml",
        "energy_kcal": 0.0,
        "protein_g": 0.0,
        "carbohydrate_g": 0.0,
        "fat_g": 0.0,
        "position": 1,
    },
)


def upgrade() -> None:
    presets = op.create_table(
        "quick_add_presets",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("quantity", sa.REAL(), nullable=False),
        sa.Column("unit", sa.String(length=30), nullable=False),
        sa.Column("energy_kcal", sa.REAL(), nullable=False),
        sa.Column("protein_g", sa.REAL(), nullable=False),
        sa.Column("carbohydrate_g", sa.REAL(), nullable=False),
        sa.Column("fat_g", sa.REAL(), nullable=False),
        sa.Column("fiber_g", sa.REAL(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    now = datetime.now(UTC)
    op.bulk_insert(
        presets,
        [
            {
                "id": uuid.uuid4(),
                "owner_id": None,
                "fiber_g": None,
                "created_at": now,
                "updated_at": now,
                **preset,
            }
            for preset in DEFAULT_PRESETS
        ],
    )


def downgrade() -> None:
    op.drop_table("quick_add_presets")
