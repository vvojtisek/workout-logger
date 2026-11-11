"""Keep set RPE in completed workout history.

Revision ID: d7e2a5c9b1f4
Revises: f2b4d6a8c0e1
"""

import json
from collections.abc import Sequence
from itertools import groupby

import sqlalchemy as sa

from alembic import op

revision: str = "d7e2a5c9b1f4"
down_revision: str | None = "f2b4d6a8c0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("exercise_logs", sa.Column("rpe_per_set", sa.JSON(), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT el.id AS log_id, el.sets_count, el.reps_per_set, el.weight_per_set, "
            "el.rir_per_set, se.reps, se.weight_kg, se.rir, se.rpe "
            "FROM exercise_logs el "
            "JOIN workout_logs wl ON wl.id = el.workout_log_id "
            "JOIN workout_sessions ws ON ws.workout_log_id = wl.id "
            "JOIN session_exercises ex ON ex.session_id = ws.id "
            "  AND ex.sort_order = el.sort_order AND ex.exercise_name = el.exercise_name "
            "JOIN set_entries se ON se.session_exercise_id = ex.id AND se.state = 'completed' "
            "WHERE ws.status = 'completed' AND ws.owner_id IS wl.owner_id "
            "ORDER BY el.id, se.set_number"
        ).columns(reps_per_set=sa.JSON(), weight_per_set=sa.JSON(), rir_per_set=sa.JSON())
    ).mappings()
    for log_id, group in groupby(rows, key=lambda row: row["log_id"]):
        entries = list(group)
        summary = entries[0]
        ratings = [entry["rpe"] for entry in entries]
        # History can be edited independently. Copy only when the two records
        # still describe the same ordered sets.
        if (
            len(entries) == summary["sets_count"]
            and summary["reps_per_set"] == [entry["reps"] for entry in entries]
            and summary["weight_per_set"] == [entry["weight_kg"] for entry in entries]
            and summary["rir_per_set"] == [entry["rir"] for entry in entries]
            and any(rating is not None for rating in ratings)
        ):
            connection.execute(
                sa.text("UPDATE exercise_logs SET rpe_per_set = :ratings WHERE id = :id"),
                {"ratings": json.dumps(ratings), "id": log_id},
            )


def downgrade() -> None:
    with op.batch_alter_table("exercise_logs") as batch_op:
        batch_op.drop_column("rpe_per_set")
