from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class LoginAttempt(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One row per login attempt (success or failure), keyed by normalized
    email and client IP. Rate limiting counts these rows in the DB rather
    than an in-process counter, so it stays correct regardless of how many
    app replicas are running."""

    __tablename__ = "login_attempts"

    email_normalized: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
