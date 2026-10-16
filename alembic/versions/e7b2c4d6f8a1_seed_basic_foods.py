"""Seed the basic foods and record where a food came from.

Revision ID: e7b2c4d6f8a1
Revises: d9e3a7b1c5f4
Create Date: 2026-10-16

Adds `catalog_id` (the seed or fallback-catalogue entry a food came from),
`category`, and per-serving vitamins and minerals to `foods`, then inserts
the basic food list as shared foods (per 100 g). The data lives in a frozen
file next to this revision; later seed changes need a new revision rather
than an edit to that file. A food that already carries a seed id is kept as
it is, so a re-run never duplicates or overwrites a user's edits.

The full fallback catalogue (app/food_catalog) is deliberately not inserted:
its entries are added one at a time when a quick add cannot find a food.
"""

import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa

import app.models.base
from alembic import op

revision: str = "e7b2c4d6f8a1"
down_revision: str | None = "d9e3a7b1c5f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED_FILE = Path(__file__).resolve().parents[1] / "seed" / "food_seed_v1.json"

foods = sa.table(
    "foods",
    sa.column("id", app.models.base.GUID(length=36)),
    sa.column("owner_id", app.models.base.GUID(length=36)),
    sa.column("name", sa.String(200)),
    sa.column("brand", sa.String(150)),
    sa.column("serving_quantity", sa.REAL()),
    sa.column("serving_unit", sa.String(30)),
    sa.column("energy_kcal", sa.REAL()),
    sa.column("protein_g", sa.REAL()),
    sa.column("carbohydrate_g", sa.REAL()),
    sa.column("fat_g", sa.REAL()),
    sa.column("fiber_g", sa.REAL()),
    sa.column("source", sa.String(30)),
    sa.column("catalog_id", sa.String(64)),
    sa.column("category", sa.String(60)),
    sa.column("vitamins_mg", sa.JSON()),
    sa.column("minerals_mg", sa.JSON()),
    sa.column("created_at", app.models.base.UTCDateTime(timezone=True)),
    sa.column("updated_at", app.models.base.UTCDateTime(timezone=True)),
)


def _seed() -> list[dict]:
    return json.loads(SEED_FILE.read_text(encoding="utf-8"))


def upgrade() -> None:
    with op.batch_alter_table("foods") as batch_op:
        batch_op.add_column(sa.Column("catalog_id", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("category", sa.String(length=60), nullable=True))
        batch_op.add_column(sa.Column("vitamins_mg", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("minerals_mg", sa.JSON(), nullable=True))
    op.create_index(
        "uq_foods_catalog_id",
        "foods",
        ["catalog_id"],
        unique=True,
        sqlite_where=sa.text("catalog_id IS NOT NULL"),
    )

    insert_missing_seed_foods(op.get_bind())


def insert_missing_seed_foods(connection: sa.Connection) -> int:
    """Inserts the seed foods whose id is not in `foods` yet; returns how many."""
    existing = {
        catalog_id
        for (catalog_id,) in connection.execute(
            sa.select(foods.c.catalog_id).where(foods.c.catalog_id.is_not(None))
        )
    }
    now = datetime.now(UTC)
    rows = [
        {
            "id": uuid.uuid4(),
            "owner_id": None,
            "name": entry["name"],
            "brand": None,
            "serving_quantity": 100.0,
            "serving_unit": "g",
            "energy_kcal": entry["kcal"],
            "protein_g": entry["macros"]["proteins"],
            "carbohydrate_g": entry["macros"]["carbs"],
            "fat_g": entry["macros"]["fats"],
            "fiber_g": entry["macros"]["fiber"],
            "source": "seed",
            "catalog_id": entry["id"],
            "category": entry["category"],
            "vitamins_mg": entry["vitamins_mg"],
            "minerals_mg": entry["minerals_mg"],
            "created_at": now,
            "updated_at": now,
        }
        for entry in _seed()
        if entry["id"] not in existing
    ]
    if rows:
        connection.execute(sa.insert(foods), rows)
    return len(rows)


def downgrade() -> None:
    seed_ids = [entry["id"] for entry in _seed()]
    # Meal items keep their nutrition snapshot (food_id is ON DELETE SET NULL).
    op.get_bind().execute(
        sa.delete(foods).where(foods.c.source == "seed", foods.c.catalog_id.in_(seed_ids))
    )
    op.drop_index("uq_foods_catalog_id", table_name="foods")
    with op.batch_alter_table("foods") as batch_op:
        batch_op.drop_column("minerals_mg")
        batch_op.drop_column("vitamins_mg")
        batch_op.drop_column("category")
        batch_op.drop_column("catalog_id")
