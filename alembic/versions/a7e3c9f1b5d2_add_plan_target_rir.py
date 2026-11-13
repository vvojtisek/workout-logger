"""Add optional target RIR to plan and session exercises.

Revision ID: a7e3c9f1b5d2
Revises: c4d6e8f0a1b3
Create Date: 2026-11-12 08:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a7e3c9f1b5d2"
down_revision: str | None = "c4d6e8f0a1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "plan_exercises",
        sa.Column(
            "target_rir",
            sa.Integer(),
            sa.CheckConstraint(
                "target_rir IS NULL OR (exercise_kind = 'strength' AND target_rir >= 0 AND target_rir <= 10)",
                name="ck_plan_exercises_target_rir_range",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "session_exercises",
        sa.Column(
            "target_rir",
            sa.Integer(),
            sa.CheckConstraint(
                "target_rir IS NULL OR (exercise_kind = 'strength' AND target_rir >= 0 AND target_rir <= 10)",
                name="ck_session_exercises_target_rir_range",
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("session_exercises", "target_rir")
    op.drop_column("plan_exercises", "target_rir")
