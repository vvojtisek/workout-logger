"""Add active workout session tables.

Revision ID: 3d62adf731c8
Revises: 93469c1ebbbf
Create Date: 2026-08-22 00:55:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "3d62adf731c8"
down_revision: str | None = "93469c1ebbbf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workout_sessions",
        sa.Column("source_plan_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("source_plan_name", sa.String(length=120), nullable=False),
        sa.Column("workout_log_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("completed_at", app.models.base.UTCDateTime(timezone=True), nullable=True),
        sa.Column("focused_exercise_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("focused_set_number", sa.Integer(), nullable=False),
        sa.Column("rest_ends_at", app.models.base.UTCDateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'completed', 'cancelled')",
            name="ck_workout_session_status",
        ),
        sa.ForeignKeyConstraint(["source_plan_id"], ["workout_plans.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workout_log_id"], ["workout_logs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workout_log_id"),
    )
    op.create_index(
        "ix_workout_sessions_status_started",
        "workout_sessions",
        ["status", "started_at"],
        unique=False,
    )
    op.create_index(
        "uq_workout_sessions_active_plan",
        "workout_sessions",
        ["source_plan_id"],
        unique=True,
        sqlite_where=sa.text("status = 'active'"),
    )
    op.create_table(
        "session_exercises",
        sa.Column("session_id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("exercise_name", sa.String(length=150), nullable=False),
        sa.Column("target_sets", sa.Integer(), nullable=False),
        sa.Column("target_reps_min", sa.Integer(), nullable=False),
        sa.Column("target_reps_max", sa.Integer(), nullable=False),
        sa.Column("target_weight_kg", sa.REAL(), nullable=True),
        sa.Column("rest_time_seconds", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("suggested_weight_kg", sa.REAL(), nullable=True),
        sa.Column("suggested_reps", sa.Integer(), nullable=False),
        sa.Column("suggestion_source", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.CheckConstraint(
            "status IN ('planned', 'completed', 'skipped')",
            name="ck_session_exercise_status",
        ),
        sa.CheckConstraint(
            "suggestion_source IN ('plan', 'history')",
            name="ck_session_exercise_suggestion_source",
        ),
        sa.ForeignKeyConstraint(["session_id"], ["workout_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "sort_order"),
    )
    op.create_index(
        "ix_session_exercises_session_order",
        "session_exercises",
        ["session_id", "sort_order"],
        unique=False,
    )
    op.create_table(
        "set_entries",
        sa.Column("session_exercise_id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("set_number", sa.Integer(), nullable=False),
        sa.Column("weight_kg", sa.REAL(), nullable=True),
        sa.Column("reps", sa.Integer(), nullable=False),
        sa.Column("rir", sa.Integer(), nullable=True),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column("completed_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("client_operation_id", sa.String(length=100), nullable=False),
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.CheckConstraint(
            "state IN ('planned', 'completed', 'skipped')",
            name="ck_set_entry_state",
        ),
        sa.ForeignKeyConstraint(
            ["session_exercise_id"], ["session_exercises.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_operation_id"),
        sa.UniqueConstraint("session_exercise_id", "set_number"),
    )
    op.create_index(
        "ix_set_entries_exercise_set",
        "set_entries",
        ["session_exercise_id", "set_number"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_set_entries_exercise_set", table_name="set_entries")
    op.drop_table("set_entries")
    op.drop_index("ix_session_exercises_session_order", table_name="session_exercises")
    op.drop_table("session_exercises")
    op.drop_index("uq_workout_sessions_active_plan", table_name="workout_sessions")
    op.drop_index("ix_workout_sessions_status_started", table_name="workout_sessions")
    op.drop_table("workout_sessions")
