from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CoachingPrinciples(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """The admin's coaching beliefs as one free text, at most one row. It is
    input for an assistant designing training blocks over MCP; the app's own
    rules (progression, load warnings) never read it."""

    __tablename__ = "coaching_principles"

    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
