"""The bundled fallback food catalogue.

The catalogue is a static file shipped with the app and is never loaded into
the database as a whole, so everyday food pickers stay short. A quick add
that cannot find a food searches this file instead and adds the one entry it
needs as an ordinary food. Nothing here calls an external service.
"""

import unicodedata
from functools import cache
from pathlib import Path

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models import Food
from app.schemas.food_catalog import CatalogEntry, CatalogFoodRead

CATALOG_FILE = Path(__file__).resolve().parents[1] / "food_catalog" / "nutridatabaze_v1.json"
SERVING_QUANTITY = 100.0
SERVING_UNIT = "g"


def fold(value: str) -> str:
    """Lower-cases and strips diacritics, so "kure" finds "Kuřecí"."""
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


@cache
def load_catalog() -> dict[str, CatalogEntry]:
    entries = TypeAdapter(list[CatalogEntry]).validate_json(CATALOG_FILE.read_bytes())
    return {entry.id: entry for entry in entries}


@cache
def _search_index() -> list[tuple[str, CatalogEntry]]:
    return sorted(
        ((fold(entry.name), entry) for entry in load_catalog().values()),
        key=lambda pair: pair[0],
    )


def search(q: str) -> list[CatalogEntry]:
    """Entries whose name contains every word of `q`; names that start with
    the first word come first, then alphabetical."""
    words = fold(q).split()
    if not words:
        return []
    matches = [
        (not name.startswith(words[0]), name, entry)
        for name, entry in _search_index()
        if all(word in name for word in words)
    ]
    matches.sort(key=lambda match: (match[0], match[1]))
    return [entry for _, _, entry in matches]


def get_entry(catalog_id: str) -> CatalogEntry:
    entry = load_catalog().get(catalog_id)
    if entry is None:
        raise NotFoundError("Catalogue food not found", code="CATALOG_FOOD_NOT_FOUND")
    return entry


async def added_food_ids(session: AsyncSession, catalog_ids: list[str]) -> dict[str, Food]:
    if not catalog_ids:
        return {}
    result = await session.execute(select(Food).where(Food.catalog_id.in_(catalog_ids)))
    return {food.catalog_id: food for food in result.scalars() if food.catalog_id}


def to_read(entry: CatalogEntry, food: Food | None) -> CatalogFoodRead:
    return CatalogFoodRead(
        catalog_id=entry.id,
        name=entry.name,
        category=entry.category,
        serving_quantity=SERVING_QUANTITY,
        serving_unit=SERVING_UNIT,
        energy_kcal=entry.kcal,
        protein_g=entry.macros.proteins,
        carbohydrate_g=entry.macros.carbs,
        fat_g=entry.macros.fats,
        fiber_g=entry.macros.fiber,
        vitamins_mg=entry.vitamins_mg,
        minerals_mg=entry.minerals_mg,
        food_id=food.id if food else None,
    )


async def add_to_foods(session: AsyncSession, catalog_id: str) -> tuple[Food, bool]:
    """Adds the catalogue entry as a food. Returns (food, created); a second
    call returns the food added the first time, whatever was edited since."""
    entry = get_entry(catalog_id)
    existing = (await added_food_ids(session, [catalog_id])).get(catalog_id)
    if existing is not None:
        return existing, False
    food = Food(
        name=entry.name,
        serving_quantity=SERVING_QUANTITY,
        serving_unit=SERVING_UNIT,
        energy_kcal=entry.kcal,
        protein_g=entry.macros.proteins,
        carbohydrate_g=entry.macros.carbs,
        fat_g=entry.macros.fats,
        fiber_g=entry.macros.fiber,
        source="catalog",
        catalog_id=entry.id,
        category=entry.category,
        vitamins_mg=entry.vitamins_mg,
        minerals_mg=entry.minerals_mg,
    )
    session.add(food)
    try:
        await session.commit()
    except IntegrityError:
        # A concurrent add of the same entry won the unique catalog_id index.
        await session.rollback()
        existing = (await added_food_ids(session, [catalog_id]))[catalog_id]
        return existing, False
    await session.refresh(food)
    return food, True
