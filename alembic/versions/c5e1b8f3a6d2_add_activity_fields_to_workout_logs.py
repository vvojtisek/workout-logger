"""Add activity type, distance and session RPE to workout logs.

Revision ID: c5e1b8f3a6d2
Revises: a7c3e9d2b4f1
Create Date: 2026-10-15 13:00:00

A workout log with an activity type and no exercises records a non-gym
session such as ice hockey or a swim. All three columns are nullable, so
existing strength logs are unchanged.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c5e1b8f3a6d2"
down_revision: str | None = "a7c3e9d2b4f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("workout_logs") as batch_op:
        batch_op.add_column(sa.Column("activity_type", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("distance_km", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("effort_rpe", sa.Integer(), nullable=True))
        batch_op.create_check_constraint(
            "ck_workout_logs_activity_type",
            "activity_type IS NULL OR activity_type IN "
            "('ice_hockey', 'swimming', 'cycling', 'hiking', 'running', 'other')",
        )
        batch_op.create_check_constraint(
            "ck_workout_logs_effort_rpe", "effort_rpe IS NULL OR effort_rpe BETWEEN 1 AND 10"
        )
        batch_op.create_check_constraint(
            "ck_workout_logs_distance_km", "distance_km IS NULL OR distance_km >= 0"
        )


def downgrade() -> None:
    with op.batch_alter_table("workout_logs") as batch_op:
        batch_op.drop_constraint("ck_workout_logs_distance_km", type_="check")
        batch_op.drop_constraint("ck_workout_logs_effort_rpe", type_="check")
        batch_op.drop_constraint("ck_workout_logs_activity_type", type_="check")
        batch_op.drop_column("effort_rpe")
        batch_op.drop_column("distance_km")
        batch_op.drop_column("activity_type")
