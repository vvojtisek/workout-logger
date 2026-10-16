"""Normalize saved unit preferences to the fixed metric convention.

Revision ID: d9e3a7b1c5f4
Revises: c2e4a6b8d0f1
Create Date: 2026-10-16
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d9e3a7b1c5f4"
down_revision: str | None = "c2e4a6b8d0f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Body metrics and workout loads are already stored in kg/cm. Only the
    # obsolete display preference changes; recorded values remain untouched.
    op.execute("UPDATE user_settings SET units = 'metric' WHERE units = 'imperial'")


def downgrade() -> None:
    # The original per-account display choices are intentionally not restored.
    pass
