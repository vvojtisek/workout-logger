"""Add the exercise catalogue.

Revision ID: f4c82c310a12
Revises: 844b72e266c6
Create Date: 2026-08-22 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "f4c82c310a12"
down_revision: str | None = "844b72e266c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "exercises",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("name", sa.String(length=150, collation="NOCASE"), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=False),
        sa.Column("media_url", sa.String(length=2000), nullable=True),
        sa.Column("primary_muscles", sa.JSON(), nullable=False),
        sa.Column("secondary_muscles", sa.JSON(), nullable=False),
        sa.Column("instructions", sa.JSON(), nullable=False),
        sa.Column("equipment", sa.String(length=200), nullable=True),
        sa.Column("safety_notes", sa.Text(), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    with op.batch_alter_table("plan_exercises") as batch_op:
        batch_op.add_column(
            sa.Column("catalog_exercise_id", app.models.base.GUID(length=36), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_plan_exercises_catalog_exercise_id",
            "exercises",
            ["catalog_exercise_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("plan_exercises") as batch_op:
        batch_op.drop_constraint("fk_plan_exercises_catalog_exercise_id", type_="foreignkey")
        batch_op.drop_column("catalog_exercise_id")

    op.drop_table("exercises")
