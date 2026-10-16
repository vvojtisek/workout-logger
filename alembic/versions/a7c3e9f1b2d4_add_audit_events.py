"""Add the action log.

Revision ID: a7c3e9f1b2d4
Revises: e7b2c4d6f8a1
Create Date: 2026-10-16

One row per REST write or MCP tool call, naming who caused it. Rows older
than 72 hours are deleted by the app (app/services/audit_log.py).
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "a7c3e9f1b2d4"
down_revision: str | None = "e7b2c4d6f8a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("occurred_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("actor_kind", sa.String(length=16), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=False),
        sa.Column("actor_subject", sa.String(length=255), nullable=True),
        sa.Column("oauth_client_id", sa.String(length=512), nullable=True),
        sa.Column("oauth_client_name", sa.String(length=255), nullable=True),
        sa.Column("mcp_client_name", sa.String(length=255), nullable=True),
        sa.Column("mcp_client_version", sa.String(length=100), nullable=True),
        sa.Column("action", sa.String(length=200), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("outcome", sa.String(length=10), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("params", sa.Text(), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_occurred_at", "audit_events", ["occurred_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audit_events_occurred_at", table_name="audit_events")
    op.drop_table("audit_events")
