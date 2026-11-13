import uuid

from sqlalchemy import REAL, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class QuickAddPreset(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A one-tap drink or snack (Cappuccino, Tea). Tapping it logs an ad hoc
    meal item with these values, so editing a preset never rewrites history.
    Values are for the whole serving, not per 100 g like `Food`."""

    __tablename__ = "quick_add_presets"

    # Nullable and unenforced by any FK, like foods: nutrition is not yet
    # private per account.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    quantity: Mapped[float] = mapped_column(REAL, nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False, default="ml")
    energy_kcal: Mapped[float] = mapped_column(REAL, nullable=False)
    protein_g: Mapped[float] = mapped_column(REAL, nullable=False)
    carbohydrate_g: Mapped[float] = mapped_column(REAL, nullable=False)
    fat_g: Mapped[float] = mapped_column(REAL, nullable=False)
    fiber_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    # Buttons are shown in ascending position, then by name.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
