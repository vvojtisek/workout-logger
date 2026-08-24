"""Add programs and scheduled workouts.

Revision ID: 81f5b00da187
Revises: f4c82c310a12
Create Date: 2026-08-22 20:52:05
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "81f5b00da187"
down_revision: str | None = "f4c82c310a12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "programs",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("kind", sa.String(length=100), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'completed', 'archived')", name="ck_programs_status"
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= start_date", name="ck_programs_date_range"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "scheduled_workouts",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("program_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("workout_plan_id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("scheduled_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("workout_session_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('scheduled', 'in_progress', 'completed', 'skipped')",
            name="ck_scheduled_workouts_status",
        ),
        sa.ForeignKeyConstraint(["program_id"], ["programs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workout_plan_id"], ["workout_plans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workout_session_id"], ["workout_sessions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workout_session_id"),
    )
    op.create_index(
        "ix_scheduled_workouts_scheduled_date",
        "scheduled_workouts",
        ["scheduled_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_scheduled_workouts_scheduled_date", table_name="scheduled_workouts")
    op.drop_table("scheduled_workouts")
    op.drop_table("programs")
