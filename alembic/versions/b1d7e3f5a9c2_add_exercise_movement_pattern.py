"""Add optional movement-pattern classification to exercises.

Revision ID: b1d7e3f5a9c2
Revises: a9c6e2f1b4d8
Create Date: 2026-11-12 12:00:00
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b1d7e3f5a9c2"
down_revision: str | None = "a9c6e2f1b4d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    with op.batch_alter_table("exercises") as batch_op:
        batch_op.add_column(sa.Column("movement_pattern", sa.String(length=30), nullable=True))
        batch_op.create_check_constraint(
            "ck_exercises_movement_pattern",
            "movement_pattern IS NULL OR movement_pattern IN "
            "('horizontal_push', 'horizontal_pull', 'vertical_push', 'vertical_pull', "
            "'squat', 'hinge', 'lunge', 'carry', 'rotation', 'core_stability', "
            "'anti_rotation', 'trunk_flexion', 'trunk_extension', 'locomotion')",
        )

    connection = op.get_bind()
    for row in connection.execute(sa.text("SELECT id, movement_patterns FROM exercises")):
        patterns = row.movement_patterns
        if isinstance(patterns, str):
            patterns = json.loads(patterns)
        if patterns:
            connection.execute(
                sa.text("UPDATE exercises SET movement_pattern = :pattern WHERE id = :id"),
                {"pattern": patterns[0], "id": row.id},
            )


def downgrade() -> None:
    with op.batch_alter_table("exercises") as batch_op:
        batch_op.drop_constraint("ck_exercises_movement_pattern", type_="check")
        batch_op.drop_column("movement_pattern")
