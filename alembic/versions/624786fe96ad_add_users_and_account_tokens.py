"""Add users and account tokens.

Revision ID: 624786fe96ad
Revises: d4e8f1a6c7b3
Create Date: 2026-08-24 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "624786fe96ad"
down_revision: str | None = "d4e8f1a6c7b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("disabled_at", app.models.base.UTCDateTime(timezone=True), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('admin', 'user')", name="ck_users_role"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "account_tokens",
        sa.Column("id", app.models.base.GUID(length=36), nullable=False),
        sa.Column("purpose", sa.String(length=20), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=20), nullable=True),
        sa.Column("user_id", app.models.base.GUID(length=36), nullable=True),
        sa.Column("issued_by", app.models.base.GUID(length=36), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_prefix", sa.String(length=16), nullable=False),
        sa.Column("expires_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("used_at", app.models.base.UTCDateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", app.models.base.UTCDateTime(timezone=True), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "purpose IN ('invite', 'password_reset')", name="ck_account_tokens_purpose"
        ),
        sa.CheckConstraint(
            "role IS NULL OR role IN ('admin', 'user')", name="ck_account_tokens_role"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_account_tokens_user_id"),
        sa.ForeignKeyConstraint(["issued_by"], ["users.id"], name="fk_account_tokens_issued_by"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_account_tokens_token_hash", "account_tokens", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_account_tokens_token_hash", table_name="account_tokens")
    op.drop_table("account_tokens")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
