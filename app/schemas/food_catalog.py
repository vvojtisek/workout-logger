from uuid import UUID

from pydantic import BaseModel, Field


class CatalogMacros(BaseModel):
    proteins: float = Field(ge=0)
    carbs: float = Field(ge=0)
    fats: float = Field(ge=0)
    fiber: float = Field(ge=0)


class CatalogEntry(BaseModel):
    """One entry of the bundled fallback catalogue, per 100 g, in its file shape."""

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(max_length=60)
    kcal: float = Field(ge=0)
    macros: CatalogMacros
    vitamins_mg: dict[str, float]
    minerals_mg: dict[str, float]


class CatalogFoodRead(BaseModel):
    catalog_id: str
    name: str
    category: str
    serving_quantity: float
    serving_unit: str
    energy_kcal: float
    protein_g: float
    carbohydrate_g: float
    fat_g: float
    fiber_g: float
    vitamins_mg: dict[str, float]
    minerals_mg: dict[str, float]
    food_id: UUID | None = Field(
        description="The food already added from this entry, or null if it is not in your foods yet."
    )


class CatalogSearchResponse(BaseModel):
    items: list[CatalogFoodRead]
    total: int = Field(description="All matches, of which at most `limit` are returned.")
    limit: int
