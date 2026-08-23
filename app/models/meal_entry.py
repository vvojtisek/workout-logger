import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UTCDateTime, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.meal_item import MealItem


class MealEntry(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "meal_entries"
    __table_args__ = (
        CheckConstraint(
            "meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')",
            name="ck_meal_entries_type",
        ),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    consumed_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False, index=True)
    meal_type: Mapped[str] = mapped_column(String(20), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)

    items: Mapped[list["MealItem"]] = relationship(
        back_populates="meal_entry", cascade="all, delete-orphan", order_by="MealItem.id"
    )
