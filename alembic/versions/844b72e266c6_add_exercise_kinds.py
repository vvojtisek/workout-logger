"""Add exercise kinds and kind-specific set fields.

Revision ID: 844b72e266c6
Revises: 8e2f78cce104
Create Date: 2026-08-22 19:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "844b72e266c6"
down_revision: str | None = "8e2f78cce104"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table_name in ("plan_exercises", "session_exercises"):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.add_column(
                sa.Column(
                    "exercise_kind",
                    sa.String(length=20),
                    nullable=False,
                    server_default="strength",
                )
            )
            batch_op.create_check_constraint(
                f"ck_{table_name}_kind",
                "exercise_kind IN ('strength', 'bodyweight', 'cardio')",
            )

    with op.batch_alter_table("set_entries") as batch_op:
        batch_op.add_column(sa.Column("added_weight_kg", sa.REAL(), nullable=True))
        batch_op.add_column(sa.Column("band_level", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("duration_seconds", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("distance_km", sa.REAL(), nullable=True))
        batch_op.add_column(sa.Column("incline_percent", sa.REAL(), nullable=True))
        batch_op.add_column(sa.Column("rpe", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("set_entries") as batch_op:
        batch_op.drop_column("rpe")
        batch_op.drop_column("incline_percent")
        batch_op.drop_column("distance_km")
        batch_op.drop_column("duration_seconds")
        batch_op.drop_column("band_level")
        batch_op.drop_column("added_weight_kg")

    for table_name in ("session_exercises", "plan_exercises"):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_constraint(f"ck_{table_name}_kind", type_="check")
        op.drop_column(table_name, "exercise_kind")
