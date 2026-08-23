"""Add health ingest support: source/external_id on body_metrics, sleep_entries,
and workout_logs, plus the new step_counts table.

Revision ID: b3f7a2c9e5d1
Revises: 12b4da9ff07b
Create Date: 2026-08-23 15:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "b3f7a2c9e5d1"
down_revision: str | None = "7a1f9c3e5b2d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("body_metrics") as batch_op:
        batch_op.add_column(
            sa.Column("source", sa.String(length=30), nullable=False, server_default="manual")
        )
        batch_op.add_column(sa.Column("external_id", sa.String(length=200), nullable=True))
        batch_op.create_unique_constraint(
            "uq_body_metrics_source_external_id", ["source", "external_id"]
        )

    with op.batch_alter_table("sleep_entries") as batch_op:
        batch_op.add_column(sa.Column("external_id", sa.String(length=200), nullable=True))
        batch_op.create_unique_constraint(
            "uq_sleep_entries_source_external_id", ["source", "external_id"]
        )

    with op.batch_alter_table("workout_logs") as batch_op:
        batch_op.add_column(
            sa.Column("source", sa.String(length=30), nullable=False, server_default="manual")
        )
        batch_op.add_column(sa.Column("external_id", sa.String(length=200), nullable=True))
        batch_op.create_unique_constraint(
            "uq_workout_logs_source_external_id", ["source", "external_id"]
        )

    op.create_table(
        "step_counts",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("owner_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("recorded_date", sa.Date(), nullable=False),
        sa.Column("steps", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("external_id", sa.String(length=200), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint("steps >= 0", name="ck_step_counts_steps_non_negative"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", "external_id", name="uq_step_counts_source_external_id"),
    )
    op.create_index("ix_step_counts_recorded_date", "step_counts", ["recorded_date"])


def downgrade() -> None:
    op.drop_index("ix_step_counts_recorded_date", table_name="step_counts")
    op.drop_table("step_counts")

    with op.batch_alter_table("workout_logs") as batch_op:
        batch_op.drop_constraint("uq_workout_logs_source_external_id", type_="unique")
        batch_op.drop_column("external_id")
        batch_op.drop_column("source")

    with op.batch_alter_table("sleep_entries") as batch_op:
        batch_op.drop_constraint("uq_sleep_entries_source_external_id", type_="unique")
        batch_op.drop_column("external_id")

    with op.batch_alter_table("body_metrics") as batch_op:
        batch_op.drop_constraint("uq_body_metrics_source_external_id", type_="unique")
        batch_op.drop_column("external_id")
        batch_op.drop_column("source")
