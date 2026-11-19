"""Allow hot tub and massage in the workout log activity check."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "26449833e44a"
down_revision: str | None = "e6c2a8f4b0d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Freeze the values here so later additions to the application enum do not
# alter what upgrading or downgrading this revision does.
OLD_TYPES = (
    "'ice_hockey', 'swimming', 'sauna', 'cycling', 'hiking', 'running', 'other', "
    "'meditation', 'stretching', 'cold_plunge'"
)
NEW_TYPES = f"{OLD_TYPES}, 'hot_tub', 'massage'"


def _replace_activity_check(values: str) -> None:
    with op.batch_alter_table("workout_logs") as batch:
        batch.drop_constraint("ck_workout_logs_activity_type", type_="check")
        batch.create_check_constraint(
            "ck_workout_logs_activity_type", f"activity_type IS NULL OR activity_type IN ({values})"
        )


def upgrade() -> None:
    _replace_activity_check(NEW_TYPES)


def downgrade() -> None:
    has_new_logs = op.get_bind().scalar(
        sa.text("SELECT 1 FROM workout_logs WHERE activity_type IN ('hot_tub', 'massage') LIMIT 1")
    )
    if has_new_logs:
        raise RuntimeError("Cannot downgrade while hot tub or massage logs exist.")
    _replace_activity_check(OLD_TYPES)
