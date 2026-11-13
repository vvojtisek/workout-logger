"""Add a target RIR and laterality to plan exercises.

Revision ID: f1a2b3c4d5e6
Revises: a7c3e9f1b2d4
Create Date: 2026-11-14 09:00:00

Expand-only: one nullable column and one column with a server default, so the
previous release keeps inserting plan exercises unchanged on this schema.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "a7c3e9f1b2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("plan_exercises") as batch_op:
        batch_op.add_column(sa.Column("target_rir", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "laterality",
                sa.String(length=12),
                nullable=False,
                server_default="bilateral",
            )
        )
        batch_op.create_check_constraint(
            "ck_plan_exercises_laterality",
            "laterality IN ('bilateral', 'per_side', 'single_limb')",
        )
        batch_op.create_check_constraint(
            "ck_plan_exercises_target_rir",
            "target_rir IS NULL OR (target_rir >= 0 AND target_rir <= 10)",
        )


def downgrade() -> None:
    with op.batch_alter_table("plan_exercises") as batch_op:
        batch_op.drop_constraint("ck_plan_exercises_target_rir", type_="check")
        batch_op.drop_constraint("ck_plan_exercises_laterality", type_="check")
        batch_op.drop_column("laterality")
        batch_op.drop_column("target_rir")
