"""Link plans to the ready-made program that created them.

Revision ID: e3a9c1f5b7d2
Revises: d8f2a4c6e1b3
Create Date: 2026-10-15 16:00:00

Removing a program created from a template now removes the plans it created,
so the same program can be started again. Nullable, so existing plans are
unchanged and stay put when a program is deleted.
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "e3a9c1f5b7d2"
down_revision: str | None = "d8f2a4c6e1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("workout_plans") as batch_op:
        batch_op.add_column(
            sa.Column(
                "program_id",
                app.models.base.GUID(length=36),
                sa.ForeignKey(
                    "programs.id",
                    ondelete="SET NULL",
                    name="fk_workout_plans_program_id_programs",
                ),
                nullable=True,
            )
        )
    op.create_index("ix_workout_plans_program_id", "workout_plans", ["program_id"])


def downgrade() -> None:
    op.drop_index("ix_workout_plans_program_id", table_name="workout_plans")
    with op.batch_alter_table("workout_plans") as batch_op:
        batch_op.drop_constraint("fk_workout_plans_program_id_programs", type_="foreignkey")
        batch_op.drop_column("program_id")
