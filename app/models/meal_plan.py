import uuid
from datetime import date

from sqlalchemy import (
    JSON,
    REAL,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class DailyMealPlan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One day's planned meals and macro targets, usually written by the
    coach. A day's targets win over the date-ranged `nutrition_plans`."""

    __tablename__ = "daily_meal_plans"
    __table_args__ = (
        Index(
            "uq_daily_meal_plans_owner_date",
            "owner_id",
            "plan_date",
            unique=True,
            sqlite_where=text("owner_id IS NOT NULL"),
        ),
        Index(
            "uq_daily_meal_plans_unowned_date",
            "plan_date",
            unique=True,
            sqlite_where=text("owner_id IS NULL"),
        ),
        CheckConstraint("source IN ('coach', 'manual')", name="ck_daily_meal_plans_source"),
        CheckConstraint(
            "energy_target_kcal >= 0 AND protein_target_g >= 0",
            name="ck_daily_meal_plans_targets",
        ),
    )

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_daily_meal_plans_owner_id_users"),
        nullable=True,
    )
    plan_date: Mapped[date] = mapped_column(Date(), nullable=False)
    energy_target_kcal: Mapped[float] = mapped_column(REAL, nullable=False)
    protein_target_g: Mapped[float] = mapped_column(REAL, nullable=False)
    fiber_target_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    carbohydrate_target_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    fat_target_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="coach")
    meals: Mapped[list["PlannedMeal"]] = relationship(
        back_populates="day_plan",
        cascade="all, delete-orphan",
        order_by="PlannedMeal.sort_order",
    )
    grocery_items: Mapped[list["GroceryItem"]] = relationship(
        back_populates="day_plan",
        cascade="all, delete-orphan",
        order_by="GroceryItem.sort_order",
    )


class PlannedMeal(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "planned_meals"
    __table_args__ = (
        UniqueConstraint("day_plan_id", "sort_order"),
        CheckConstraint(
            "meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')",
            name="ck_planned_meals_type",
        ),
        CheckConstraint(
            "energy_kcal >= 0 AND protein_g >= 0 AND carbohydrate_g >= 0 AND fat_g >= 0",
            name="ck_planned_meals_macros",
        ),
    )

    day_plan_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("daily_meal_plans.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    meal_type: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    prep_steps: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    energy_kcal: Mapped[float] = mapped_column(REAL, nullable=False)
    protein_g: Mapped[float] = mapped_column(REAL, nullable=False)
    carbohydrate_g: Mapped[float] = mapped_column(REAL, nullable=False)
    fat_g: Mapped[float] = mapped_column(REAL, nullable=False)
    fiber_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    eaten_meal_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("meal_entries.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    day_plan: Mapped["DailyMealPlan"] = relationship(back_populates="meals")
    ingredients: Mapped[list["PlannedMealIngredient"]] = relationship(
        back_populates="meal",
        cascade="all, delete-orphan",
        order_by="PlannedMealIngredient.sort_order",
    )


class PlannedMealIngredient(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "planned_meal_ingredients"
    __table_args__ = (
        UniqueConstraint("meal_id", "sort_order"),
        CheckConstraint("quantity > 0", name="ck_planned_meal_ingredients_quantity"),
    )

    meal_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("planned_meals.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    quantity: Mapped[float] = mapped_column(REAL, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("foods.id", ondelete="SET NULL"), nullable=True
    )
    # Optional per-ingredient macros at this quantity; when every ingredient
    # has them, "eaten" logs one meal item per ingredient.
    energy_kcal: Mapped[float | None] = mapped_column(REAL, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    carbohydrate_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    fiber_g: Mapped[float | None] = mapped_column(REAL, nullable=True)
    # Kitchen checklist: struck through once weighed out or prepared.
    prepared: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    meal: Mapped["PlannedMeal"] = relationship(back_populates="ingredients")


class GroceryItem(UUIDPrimaryKeyMixin, Base):
    """A day's shopping list line: the day's ingredients summed by name and
    unit. Rebuilt on every plan write; `checked` survives for lines that stay."""

    __tablename__ = "grocery_items"
    __table_args__ = (
        UniqueConstraint("day_plan_id", "name_key", "unit"),
        CheckConstraint("quantity > 0", name="ck_grocery_items_quantity"),
    )

    day_plan_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("daily_meal_plans.id", ondelete="CASCADE"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    name_key: Mapped[str] = mapped_column(String(150), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[float] = mapped_column(REAL, nullable=False)
    checked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    day_plan: Mapped["DailyMealPlan"] = relationship(back_populates="grocery_items")
