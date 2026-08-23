import uuid
from typing import TYPE_CHECKING

from sqlalchemy import REAL, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.meal_entry import MealEntry


class MealItem(UUIDPrimaryKeyMixin, Base):
    """One logged food within a meal entry. Nutrition values are snapshotted
    at the logged quantity, scaled from the food's per-serving values, so
    later edits to the food catalogue never rewrite history."""

    __tablename__ = "meal_items"

    meal_entry_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("meal_entries.id", ondelete="CASCADE"), nullable=False
    )
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("foods.id", ondelete="SET NULL"), nullable=True
    )
    food_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    quantity: Mapped[float] = mapped_column(REAL, nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False)
    energy_kcal_snapshot: Mapped[float] = mapped_column(REAL, nullable=False)
    protein_g_snapshot: Mapped[float] = mapped_column(REAL, nullable=False)
    carbohydrate_g_snapshot: Mapped[float] = mapped_column(REAL, nullable=False)
    fat_g_snapshot: Mapped[float] = mapped_column(REAL, nullable=False)
    fiber_g_snapshot: Mapped[float | None] = mapped_column(REAL, nullable=True)

    meal_entry: Mapped["MealEntry"] = relationship(back_populates="items")
