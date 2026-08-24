import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin


class AccountToken(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A single-use, hashed, out-of-band credential handed to a person outside
    the app (no SMTP exists here): either an admin-issued invite that lets
    someone create their account, or an admin-issued password reset. The raw
    token is generated once and shown once; only its hash is stored, mirroring
    `ApiToken`'s hash+prefix pattern."""

    __tablename__ = "account_tokens"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('invite', 'password_reset')", name="ck_account_tokens_purpose"
        ),
        CheckConstraint("role IS NULL OR role IN ('admin', 'user')", name="ck_account_tokens_role"),
    )

    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    # Invite target, before any User row exists for them.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Reset target; null for a pending invite (the account doesn't exist yet).
    user_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("users.id"), nullable=True)
    # Admin who issued this token. Nullable so the CLI-bootstrapped first
    # admin (created with no inviter) is representable.
    issued_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    token_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
