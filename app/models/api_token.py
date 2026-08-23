import uuid
from datetime import datetime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin


class ApiToken(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A scoped, hashed bearer credential. The raw secret is generated once at
    creation time and returned to the caller; only its SHA-256 hash is stored,
    looked up by an indexed unique column rather than compared row by row."""

    __tablename__ = "api_tokens"

    # Nullable and unenforced by any FK: there is no users table yet. Carrying
    # this column now makes the future multi-user migration additive.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    # First few characters of the raw secret, kept only so a token can be
    # recognized in a list; never enough to reconstruct or brute-force it.
    token_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    # Comma-joined scope names, e.g. "read,log". Validated against the
    # allowed set in the Pydantic schema, not enforced at the DB layer.
    scopes: Mapped[str] = mapped_column(String(50), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
