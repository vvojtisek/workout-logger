import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin


class McpOAuthClient(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Dynamically registered MCP OAuth 2.1 client persisted in SQLite so
    linked AI subscriptions survive container restarts and are included in
    nightly SQLite backups."""

    __tablename__ = "mcp_oauth_clients"
    __table_args__ = (
        CheckConstraint(
            "token_endpoint_auth_method IN ('none', 'client_secret_post')",
            name="ck_mcp_oauth_clients_auth_method",
        ),
        Index("ix_mcp_oauth_clients_client_id", "client_id", unique=True),
    )

    client_id: Mapped[str] = mapped_column(String(128), nullable=False)
    client_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    client_secret_encrypted: Mapped[str | None] = mapped_column(Text(), nullable=True)
    token_endpoint_auth_method: Mapped[str] = mapped_column(
        String(32), nullable=False, default="client_secret_post"
    )
    grant_types: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    response_types: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    redirect_uris: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    allowed_scopes: Mapped[str] = mapped_column(String(100), nullable=False)
    client_id_issued_at: Mapped[int] = mapped_column(Integer, nullable=False)
    client_secret_expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class McpOAuthToken(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Opaque SHA-256 hashed MCP OAuth 2.1 access and refresh tokens with
    Fernet-encrypted metadata for deterministic key-rotation handling."""

    __tablename__ = "mcp_oauth_tokens"
    __table_args__ = (
        CheckConstraint(
            "token_type IN ('access', 'refresh')",
            name="ck_mcp_oauth_tokens_type",
        ),
        Index("ix_mcp_oauth_tokens_token_hash", "token_hash", unique=True),
        Index("ix_mcp_oauth_tokens_client_id", "client_id"),
        Index("ix_mcp_oauth_tokens_family_id", "token_family_id"),
        Index("ix_mcp_oauth_tokens_expires_at", "expires_at"),
        UniqueConstraint("token_hash", name="uq_mcp_oauth_tokens_token_hash"),
    )

    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    token_type: Mapped[str] = mapped_column(String(16), nullable=False)
    client_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("mcp_oauth_clients.client_id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_family_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False)
    scopes: Mapped[str] = mapped_column(String(100), nullable=False)
    resource: Mapped[str] = mapped_column(String(500), nullable=False)
    encrypted_metadata: Mapped[str] = mapped_column(Text(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    absolute_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    rotated_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
