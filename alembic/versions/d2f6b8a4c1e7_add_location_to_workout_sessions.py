"""Record where a workout happens.

Revision ID: d2f6b8a4c1e7
Revises: c8e4a1d6f2b9
Create Date: 2026-10-15 22:00:00

Nullable, so existing sessions and the previous release are unaffected.
Deleting a location keeps its workouts and clears the link.
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "d2f6b8a4c1e7"
down_revision: str | None = "c8e4a1d6f2b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("workout_sessions") as batch_op:
        batch_op.add_column(
            sa.Column(
                "location_id",
                app.models.base.GUID(length=36),
                sa.ForeignKey(
                    "locations.id",
                    ondelete="SET NULL",
                    name="fk_workout_sessions_location_id_locations",
                ),
                nullable=True,
            )
        )
    op.create_index("ix_workout_sessions_location_id", "workout_sessions", ["location_id"])


def downgrade() -> None:
    op.drop_index("ix_workout_sessions_location_id", table_name="workout_sessions")
    with op.batch_alter_table("workout_sessions") as batch_op:
        batch_op.drop_constraint("fk_workout_sessions_location_id_locations", type_="foreignkey")
        batch_op.drop_column("location_id")
