import json
import os

from app.services import food_catalog

BASE = "/api/v1/food-catalog"
FOODS = "/api/v1/foods"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED_FILE = os.path.join(REPO_ROOT, "alembic", "seed", "food_seed_v1.json")


def test_bundled_catalogue_loads_with_unique_ids():
    catalog = food_catalog.load_catalog()
    assert len(catalog) == 1030
    assert all(catalog_id.startswith("ndb-") for catalog_id in catalog)


def test_seed_ids_are_unique_and_do_not_collide_with_the_catalogue():
    with open(SEED_FILE, encoding="utf-8") as handle:
        seed = json.load(handle)
    ids = [entry["id"] for entry in seed]
    assert len(ids) == 37
    assert len(set(ids)) == len(ids)
    # Both files share the foods.catalog_id namespace, so an id clash would make
    # a catalogue entry look already added.
    assert not set(ids) & set(food_catalog.load_catalog())


def test_fold_ignores_case_and_diacritics():
    assert food_catalog.fold("Kuřecí ŘÍZEK") == "kureci rizek"


async def test_search_matches_every_word_without_diacritics(client, auth_headers):
    response = await client.get(f"{BASE}?q=vlocky ovesne", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert [item["catalog_id"] for item in body["items"]] == ["ndb-0188"]
    item = body["items"][0]
    assert item["name"] == "Vločky ovesné"
    assert item["serving_quantity"] == 100
    assert item["serving_unit"] == "g"
    assert item["energy_kcal"] == 353
    assert item["protein_g"] == 13.1
    assert item["food_id"] is None


async def test_search_ranks_names_starting_with_the_query_first(client, auth_headers):
    response = await client.get(f"{BASE}?q=mrkev", headers=auth_headers)
    names = [item["name"] for item in response.json()["items"]]
    assert names[0] == "Mrkev"
    assert all(name.lower().startswith("mrkev") for name in names[:3])


async def test_search_limits_results_and_reports_the_total(client, auth_headers):
    response = await client.get(f"{BASE}?q=maso&limit=5", headers=auth_headers)
    body = response.json()
    assert len(body["items"]) == 5
    assert body["total"] > 5
    assert body["limit"] == 5


async def test_search_requires_two_characters(client, auth_headers):
    response = await client.get(f"{BASE}?q=m", headers=auth_headers)
    assert response.status_code == 422


async def test_search_requires_authentication(client):
    response = await client.get(f"{BASE}?q=mrkev")
    assert response.status_code == 401


async def test_catalogue_is_not_part_of_the_food_list(client, auth_headers):
    response = await client.get(FOODS, headers=auth_headers)
    assert response.json()["total"] == 0


async def test_add_from_catalogue_creates_a_food_once(client, auth_headers):
    first = await client.post(f"{BASE}/ndb-0062/add", headers=auth_headers)
    assert first.status_code == 201
    food = first.json()
    assert food["name"] == "Mrkev"
    assert food["source"] == "catalog"
    assert food["catalog_id"] == "ndb-0062"
    assert food["category"] == "katalog"
    assert food["minerals_mg"] == {"Na": 80}
    assert (food["serving_quantity"], food["serving_unit"], food["energy_kcal"]) == (100, "g", 36)
    assert first.headers["Location"] == f"{FOODS}/{food['id']}"

    again = await client.post(f"{BASE}/ndb-0062/add", headers=auth_headers)
    assert again.status_code == 200
    assert again.json()["id"] == food["id"]

    listed = await client.get(FOODS, headers=auth_headers)
    assert [item["id"] for item in listed.json()["items"]] == [food["id"]]

    search = await client.get(f"{BASE}?q=mrkev", headers=auth_headers)
    by_id = {item["catalog_id"]: item["food_id"] for item in search.json()["items"]}
    assert by_id["ndb-0062"] == food["id"]
    assert by_id["ndb-0930"] is None


async def test_add_from_catalogue_keeps_user_edits(client, auth_headers):
    food = (await client.post(f"{BASE}/ndb-0062/add", headers=auth_headers)).json()
    edited = {
        key: food[key]
        for key in (
            "name",
            "brand",
            "serving_quantity",
            "serving_unit",
            "energy_kcal",
            "protein_g",
            "carbohydrate_g",
            "fat_g",
            "fiber_g",
            "source",
            "category",
            "vitamins_mg",
            "minerals_mg",
        )
    }
    edited["name"] = "Mrkev z trhu"
    replaced = await client.put(f"{FOODS}/{food['id']}", json=edited, headers=auth_headers)
    assert replaced.status_code == 200
    assert replaced.json()["catalog_id"] == "ndb-0062"

    again = await client.post(f"{BASE}/ndb-0062/add", headers=auth_headers)
    assert again.status_code == 200
    assert again.json()["name"] == "Mrkev z trhu"


async def test_add_unknown_catalogue_id_returns_404(client, auth_headers):
    response = await client.post(f"{BASE}/ndb-9999/add", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "CATALOG_FOOD_NOT_FOUND"


async def test_food_added_from_catalogue_can_be_logged_in_a_meal(client, auth_headers):
    food = (await client.post(f"{BASE}/ndb-0188/add", headers=auth_headers)).json()
    response = await client.post(
        "/api/v1/meal-entries",
        json={
            "consumed_at": "2026-10-16T07:30:00Z",
            "meal_type": "breakfast",
            "items": [{"food_id": food["id"], "quantity": 50}],
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    item = response.json()["items"][0]
    assert item["food_name_snapshot"] == "Vločky ovesné"
    assert item["energy_kcal_snapshot"] == 176.5
