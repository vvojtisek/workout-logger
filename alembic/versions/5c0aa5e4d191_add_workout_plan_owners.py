"""Add account ownership to personal workout records.

Revision ID: 5c0aa5e4d191
Revises: fce0c499942e
Create Date: 2026-10-13 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "5c0aa5e4d191"
down_revision: str | None = "fce0c499942e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table_name in ("workout_plans", "workout_logs", "workout_sessions", "exercises"):
        with op.batch_alter_table(
            table_name,
            naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"},
        ) as batch_op:
            if table_name in {"workout_plans", "exercises"}:
                batch_op.drop_constraint(f"uq_{table_name}_name", type_="unique")
            batch_op.add_column(
                sa.Column(
                    "owner_id",
                    app.models.base.GUID(length=36),
                    sa.ForeignKey(
                        "users.id",
                        ondelete="SET NULL",
                        name=f"fk_{table_name}_owner_id_users",
                    ),
                    nullable=True,
                )
            )
        op.create_index(f"ix_{table_name}_owner_id", table_name, ["owner_id"])

    for table_name in ("workout_plans", "exercises"):
        op.create_index(
            f"uq_{table_name}_owner_name",
            table_name,
            ["owner_id", "name"],
            unique=True,
            sqlite_where=sa.text("owner_id IS NOT NULL"),
        )
        op.create_index(
            f"uq_{table_name}_unowned_name",
            table_name,
            ["name"],
            unique=True,
            sqlite_where=sa.text("owner_id IS NULL"),
        )

    # Existing personal records were written before accounts had data isolation.
    # Attribute those records to the first account administrator, when one exists.
    # The null owner remains readable only with the bootstrap API key otherwise.
    for table_name in (
        "workout_plans",
        "workout_logs",
        "workout_sessions",
        "programs",
        "scheduled_workouts",
        "body_metrics",
        "foods",
        "meal_entries",
        "nutrition_plans",
        "sleep_entries",
        "step_counts",
        "user_settings",
    ):
        op.execute(
            sa.text(
                f"UPDATE {table_name} SET owner_id = "
                "(SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1) "
                "WHERE owner_id IS NULL"
            )
        )

    for table_name in ("body_metrics", "sleep_entries", "step_counts", "workout_logs"):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_constraint(f"uq_{table_name}_source_external_id", type_="unique")
        op.create_index(
            f"uq_{table_name}_owner_source_external_id",
            table_name,
            ["owner_id", "source", "external_id"],
            unique=True,
            sqlite_where=sa.text("owner_id IS NOT NULL"),
        )
        op.create_index(
            f"uq_{table_name}_unowned_source_external_id",
            table_name,
            ["source", "external_id"],
            unique=True,
            sqlite_where=sa.text("owner_id IS NULL"),
        )


def downgrade() -> None:
    for table_name in ("workout_logs", "step_counts", "sleep_entries", "body_metrics"):
        op.drop_index(f"uq_{table_name}_owner_source_external_id", table_name=table_name)
        op.drop_index(f"uq_{table_name}_unowned_source_external_id", table_name=table_name)
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.create_unique_constraint(
                f"uq_{table_name}_source_external_id", ["source", "external_id"]
            )
    for table_name in ("exercises", "workout_plans"):
        op.drop_index(f"uq_{table_name}_owner_name", table_name=table_name)
        op.drop_index(f"uq_{table_name}_unowned_name", table_name=table_name)
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.create_unique_constraint(f"uq_{table_name}_name", ["name"])
    for table_name in ("exercises", "workout_sessions", "workout_logs", "workout_plans"):
        op.drop_index(f"ix_{table_name}_owner_id", table_name=table_name)
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_column("owner_id")
