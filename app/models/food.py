import uuid

from sqlalchemy import REAL, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class Food(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A reusable food catalogue entry. Meal items snapshot these values at
    log time (see `MealItem`), so editing a food never rewrites history."""

    __tablename__ = "foods"

    # Nullable and unenforced by any FK: there is no users table yet. Carrying
    # this column now makes the future multi-user migration additive.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(150), nullable=True)
    serving_quantity: Mapped[float] = mapped_column(REAL, nullable=False)
    serving_unit: Mapped[str] = mapped_column(String(30), nullable=False)
    energy_kcal: Mapped[float] = mapped_column(REAL, nullable=False)
    protein_g: Mapped[float] = mapped_column(REAL, nullable=False)
    carbohydrate_g: Mapped[float] = mapped_column(REAL, nullable=False)
    fat_g: Mapped[float] = mapped_column(REAL, nullable=False)
    fiber_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")
