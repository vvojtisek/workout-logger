"""Add cardio and recovery fields to workout logs.

Revision ID: e6c2a8f4b0d3
Revises: d1a5c7e9b3f2
Create Date: 2026-11-15 13:00:00

Additive only. New columns are nullable, so every existing log keeps its
values. The activity check gains meditation, stretching and cold_plunge, done
with a SQLite table copy that keeps every row. Existing sauna logs get their
rounds copied into the new generic `cycles` column; `sauna_rounds` is kept.
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "e6c2a8f4b0d3"
down_revision: str | None = "d1a5c7e9b3f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_ACTIVITY_TYPES = "('ice_hockey', 'swimming', 'sauna', 'cycling', 'hiking', 'running', 'other')"
NEW_ACTIVITY_TYPES = (
    "('ice_hockey', 'swimming', 'sauna', 'cycling', 'hiking', 'running', 'other', "
    "'meditation', 'stretching', 'cold_plunge')"
)


def upgrade() -> None:
    with op.batch_alter_table("workout_logs") as batch_op:
        batch_op.add_column(sa.Column("activity_name", sa.String(length=60), nullable=True))
        batch_op.add_column(sa.Column("effort_level", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("feel_before", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("feel_after", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("cycles", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("cycle_minutes", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("linked_log_id", app.models.base.GUID(length=36), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_workout_logs_linked_log_id_workout_logs",
            "workout_logs",
            ["linked_log_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_workout_logs_linked_log_id", ["linked_log_id"])
        batch_op.drop_constraint("ck_workout_logs_activity_type", type_="check")
        batch_op.create_check_constraint(
            "ck_workout_logs_activity_type",
            f"activity_type IS NULL OR activity_type IN {NEW_ACTIVITY_TYPES}",
        )
        batch_op.create_check_constraint(
            "ck_workout_logs_effort_level", "effort_level IS NULL OR effort_level BETWEEN 1 AND 5"
        )
        batch_op.create_check_constraint(
            "ck_workout_logs_feel_before", "feel_before IS NULL OR feel_before BETWEEN 1 AND 5"
        )
        batch_op.create_check_constraint(
            "ck_workout_logs_feel_after", "feel_after IS NULL OR feel_after BETWEEN 1 AND 5"
        )
        batch_op.create_check_constraint(
            "ck_workout_logs_cycles", "cycles IS NULL OR cycles BETWEEN 1 AND 20"
        )
        batch_op.create_check_constraint(
            "ck_workout_logs_cycle_minutes",
            "cycle_minutes IS NULL OR cycle_minutes BETWEEN 1 AND 240",
        )
        batch_op.create_check_constraint(
            "ck_workout_logs_linked_log_id", "linked_log_id IS NULL OR linked_log_id <> id"
        )

    op.execute(
        "UPDATE workout_logs SET cycles = sauna_rounds "
        "WHERE activity_type = 'sauna' AND sauna_rounds BETWEEN 1 AND 20"
    )


def downgrade() -> None:
    # The old activity check cannot hold these rows; fail instead of deleting data.
    bind = op.get_bind()
    blocked = bind.execute(
        sa.text(
            "SELECT COUNT(*) FROM workout_logs "
            "WHERE activity_type IN ('meditation', 'stretching', 'cold_plunge')"
        )
    ).scalar()
    if blocked:
        raise RuntimeError(
            "Cannot downgrade: meditation, stretching or cold plunge logs exist and the old "
            "schema rejects them"
        )

    with op.batch_alter_table("workout_logs") as batch_op:
        batch_op.drop_constraint("ck_workout_logs_linked_log_id", type_="check")
        batch_op.drop_constraint("ck_workout_logs_cycle_minutes", type_="check")
        batch_op.drop_constraint("ck_workout_logs_cycles", type_="check")
        batch_op.drop_constraint("ck_workout_logs_feel_after", type_="check")
        batch_op.drop_constraint("ck_workout_logs_feel_before", type_="check")
        batch_op.drop_constraint("ck_workout_logs_effort_level", type_="check")
        batch_op.drop_constraint("ck_workout_logs_activity_type", type_="check")
        batch_op.create_check_constraint(
            "ck_workout_logs_activity_type",
            f"activity_type IS NULL OR activity_type IN {OLD_ACTIVITY_TYPES}",
        )
        batch_op.drop_index("ix_workout_logs_linked_log_id")
        batch_op.drop_constraint("fk_workout_logs_linked_log_id_workout_logs", type_="foreignkey")
        batch_op.drop_column("linked_log_id")
        batch_op.drop_column("cycle_minutes")
        batch_op.drop_column("cycles")
        batch_op.drop_column("feel_after")
        batch_op.drop_column("feel_before")
        batch_op.drop_column("effort_level")
        batch_op.drop_column("activity_name")
