import uuid

from sqlalchemy import JSON, REAL, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class Food(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A reusable food catalogue entry. Meal items snapshot these values at
    log time (see `MealItem`), so editing a food never rewrites history."""

    __tablename__ = "foods"
    __table_args__ = (
        Index(
            "uq_foods_catalog_id",
            "catalog_id",
            unique=True,
            sqlite_where=text("catalog_id IS NOT NULL"),
        ),
    )

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
    # The seed or fallback-catalogue entry this food came from ("bread-rye",
    # "ndb-0188"). It is how a catalogue entry is recognised as already added.
    catalog_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Per serving, keyed by nutrient symbol ("B1", "Na"), values in mg.
    vitamins_mg: Mapped[dict[str, float] | None] = mapped_column(JSON, nullable=True)
    minerals_mg: Mapped[dict[str, float] | None] = mapped_column(JSON, nullable=True)
