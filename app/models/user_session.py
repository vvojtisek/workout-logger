import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin


class UserSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A server-side, revocable browser login session. The raw token lives
    only in an HttpOnly cookie on the client; only its hash is stored here,
    mirroring `ApiToken`'s hash+prefix pattern -- this is what makes real
    server-side revocation possible (a signed/JWT cookie could not do this).

    Named `UserSession` rather than `Session` to avoid any confusion with
    SQLAlchemy's own `Session`/`AsyncSession` types used throughout this
    codebase."""

    __tablename__ = "sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    token_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    # Hard cap set once at creation; never extended. Independent of the
    # sliding idle timeout enforced in app/services/sessions.py.
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
