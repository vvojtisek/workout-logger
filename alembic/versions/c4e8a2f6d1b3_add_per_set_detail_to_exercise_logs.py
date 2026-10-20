"""Keep each set's weight and RIR on exercise logs.

Revision ID: c4e8a2f6d1b3
Revises: b5d8f2a4c6e1
Create Date: 2026-10-19

Both columns are nullable, so the previous release still runs on this schema.
Logs finished from a live session get their per-set values copied from that
session's completed sets, matched by exercise order, when the set counts agree.
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4e8a2f6d1b3"
down_revision: str | None = "b5d8f2a4c6e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("exercise_logs") as batch_op:
        batch_op.add_column(sa.Column("weight_per_set", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("rir_per_set", sa.JSON(), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT el.id, el.sets_count, se.weight_kg, se.rir, ex.id AS exercise_id "
            "FROM exercise_logs el "
            "JOIN workout_sessions ws ON ws.workout_log_id = el.workout_log_id "
            "JOIN session_exercises ex "
            "  ON ex.session_id = ws.id AND ex.sort_order = el.sort_order "
            "JOIN set_entries se "
            "  ON se.session_exercise_id = ex.id AND se.state = 'completed' "
            "ORDER BY el.id, se.set_number"
        )
    ).all()
    per_log: dict[str, tuple[int, list, list]] = {}
    for log_id, sets_count, weight, rir, _ in rows:
        _, weights, rirs = per_log.setdefault(log_id, (sets_count, [], []))
        weights.append(weight)
        rirs.append(rir)
    for log_id, (sets_count, weights, rirs) in per_log.items():
        if len(weights) != sets_count:
            continue
        connection.execute(
            sa.text(
                "UPDATE exercise_logs SET weight_per_set = :weights, rir_per_set = :rirs "
                "WHERE id = :id"
            ),
            {"weights": json.dumps(weights), "rirs": json.dumps(rirs), "id": log_id},
        )


def downgrade() -> None:
    with op.batch_alter_table("exercise_logs") as batch_op:
        batch_op.drop_column("rir_per_set")
        batch_op.drop_column("weight_per_set")
