from datetime import datetime

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UTCDateTime, UUIDPrimaryKeyMixin, utcnow


class AuditEvent(UUIDPrimaryKeyMixin, Base):
    """One action and who caused it, kept for 72 hours (app/services/audit_log.py).

    `actor_kind` is `user` (a logged-in account, i.e. the app's UI), `api_token`,
    `api_key` (the bootstrap key) or `mcp` (an OAuth-authenticated MCP client).
    For `mcp`, the OAuth fields and the client's own `initialize` self-report
    are stored as received; nothing here says which company or model is behind
    a client unless the client reports it. `params` is a JSON summary that
    keeps identifiers and names and replaces every other value with its type,
    so health values, passwords and tokens never land here. Not owner-scoped:
    only an admin reads it."""

    __tablename__ = "audit_events"

    occurred_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=utcnow, nullable=False, index=True
    )
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oauth_client_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    oauth_client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mcp_client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mcp_client_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    action: Mapped[str] = mapped_column(String(200), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    outcome: Mapped[str] = mapped_column(String(10), nullable=False)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    params: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
