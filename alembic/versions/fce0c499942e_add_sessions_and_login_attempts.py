"""Add sessions and login attempts.

Revision ID: fce0c499942e
Revises: 624786fe96ad
Create Date: 2026-08-24 13:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "fce0c499942e"
down_revision: str | None = "624786fe96ad"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("user_id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_prefix", sa.String(length=16), nullable=False),
        sa.Column("expires_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", app.models.base.UTCDateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_sessions_user_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], unique=False)
    op.create_index("ix_sessions_token_hash", "sessions", ["token_hash"], unique=True)

    op.create_table(
        "login_attempts",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("email_normalized", sa.String(length=255), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=False),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_login_attempts_email_normalized", "login_attempts", ["email_normalized"], unique=False
    )
    op.create_index("ix_login_attempts_ip_address", "login_attempts", ["ip_address"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_login_attempts_ip_address", table_name="login_attempts")
    op.drop_index("ix_login_attempts_email_normalized", table_name="login_attempts")
    op.drop_table("login_attempts")
    op.drop_index("ix_sessions_token_hash", table_name="sessions")
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_table("sessions")
