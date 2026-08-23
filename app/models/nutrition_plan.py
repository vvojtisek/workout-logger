import uuid
from datetime import date

from sqlalchemy import REAL, CheckConstraint, Date, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class NutritionPlan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A dated set of daily macro targets. Deliberately no overlap
    constraint on (owner, date range) — same pattern as `Program`."""

    __tablename__ = "nutrition_plans"
    __table_args__ = (
        CheckConstraint(
            "valid_to IS NULL OR valid_to >= valid_from", name="ck_nutrition_plans_date_range"
        ),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    valid_from: Mapped[date] = mapped_column(Date(), nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date(), nullable=True)
    energy_target_kcal: Mapped[float] = mapped_column(REAL, nullable=False)
    protein_target_g: Mapped[float] = mapped_column(REAL, nullable=False)
    carbohydrate_target_g: Mapped[float] = mapped_column(REAL, nullable=False)
    fat_target_g: Mapped[float] = mapped_column(REAL, nullable=False)
    fiber_target_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
