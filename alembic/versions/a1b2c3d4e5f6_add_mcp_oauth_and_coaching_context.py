"""Add SQLite tables for app-native single-owner MCP OAuth 2.1 and two-tier coaching context

Revision ID: a1b2c3d4e5f6
Revises: 26449833e44a
Create Date: 2026-11-23 19:05:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.models.base import GUID, UTCDateTime

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "26449833e44a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mcp_oauth_clients",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("client_id", sa.String(length=128), nullable=False),
        sa.Column("client_name", sa.String(length=200), nullable=True),
        sa.Column("client_secret_encrypted", sa.Text(), nullable=True),
        sa.Column("token_endpoint_auth_method", sa.String(length=32), nullable=False),
        sa.Column("grant_types", sa.JSON(), nullable=False),
        sa.Column("response_types", sa.JSON(), nullable=False),
        sa.Column("redirect_uris", sa.JSON(), nullable=False),
        sa.Column("allowed_scopes", sa.String(length=100), nullable=False),
        sa.Column("client_id_issued_at", sa.Integer(), nullable=False),
        sa.Column("client_secret_expires_at", sa.Integer(), nullable=True),
        sa.Column("last_used_at", UTCDateTime(), nullable=True),
        sa.Column("revoked_at", UTCDateTime(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "token_endpoint_auth_method IN ('none', 'client_secret_post')",
            name="ck_mcp_oauth_clients_auth_method",
        ),
    )
    op.create_index(
        "ix_mcp_oauth_clients_client_id",
        "mcp_oauth_clients",
        ["client_id"],
        unique=True,
    )

    op.create_table(
        "mcp_oauth_tokens",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_type", sa.String(length=16), nullable=False),
        sa.Column("client_id", sa.String(length=128), nullable=False),
        sa.Column("user_id", GUID(), nullable=False),
        sa.Column("token_family_id", GUID(), nullable=False),
        sa.Column("scopes", sa.String(length=100), nullable=False),
        sa.Column("resource", sa.String(length=500), nullable=False),
        sa.Column("encrypted_metadata", sa.Text(), nullable=False),
        sa.Column("expires_at", UTCDateTime(), nullable=False),
        sa.Column("absolute_expires_at", UTCDateTime(), nullable=True),
        sa.Column("rotated_at", UTCDateTime(), nullable=True),
        sa.Column("revoked_at", UTCDateTime(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["mcp_oauth_clients.client_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_mcp_oauth_tokens_token_hash"),
        sa.CheckConstraint(
            "token_type IN ('access', 'refresh')",
            name="ck_mcp_oauth_tokens_type",
        ),
    )
    op.create_index(
        "ix_mcp_oauth_tokens_token_hash", "mcp_oauth_tokens", ["token_hash"], unique=True
    )
    op.create_index("ix_mcp_oauth_tokens_client_id", "mcp_oauth_tokens", ["client_id"])
    op.create_index("ix_mcp_oauth_tokens_family_id", "mcp_oauth_tokens", ["token_family_id"])
    op.create_index("ix_mcp_oauth_tokens_expires_at", "mcp_oauth_tokens", ["expires_at"])

    op.create_table(
        "coaching_context",
        sa.Column("id", GUID(), nullable=False),
        sa.Column("owner_id", GUID(), nullable=True),
        sa.Column(
            "singleton_key",
            sa.String(length=20),
            nullable=False,
            server_default="default",
        ),
        sa.Column("athlete_profile_md", sa.Text(), nullable=True),
        sa.Column("working_notes_md", sa.Text(), nullable=True),
        sa.Column("profile_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("notes_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("previous_profile_md", sa.Text(), nullable=True),
        sa.Column("previous_notes_md", sa.Text(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("singleton_key", name="uq_coaching_context_singleton_key"),
        sa.CheckConstraint("profile_version >= 1", name="ck_coaching_context_profile_version"),
        sa.CheckConstraint("notes_version >= 1", name="ck_coaching_context_notes_version"),
    )


def downgrade() -> None:
    op.drop_table("coaching_context")
    op.drop_index("ix_mcp_oauth_tokens_expires_at", table_name="mcp_oauth_tokens")
    op.drop_index("ix_mcp_oauth_tokens_family_id", table_name="mcp_oauth_tokens")
    op.drop_index("ix_mcp_oauth_tokens_client_id", table_name="mcp_oauth_tokens")
    op.drop_index("ix_mcp_oauth_tokens_token_hash", table_name="mcp_oauth_tokens")
    op.drop_table("mcp_oauth_tokens")
    op.drop_index("ix_mcp_oauth_clients_client_id", table_name="mcp_oauth_clients")
    op.drop_table("mcp_oauth_clients")
