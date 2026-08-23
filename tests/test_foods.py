import uuid

BASE = "/api/v1/foods"


def make_food_payload(**overrides) -> dict:
    payload = {
        "name": "Chicken Breast",
        "brand": None,
        "serving_quantity": 100,
        "serving_unit": "g",
        "energy_kcal": 165,
        "protein_g": 31,
        "carbohydrate_g": 0,
        "fat_g": 3.6,
        "fiber_g": 0,
    }
    payload.update(overrides)
    return payload


async def test_create_food_with_full_fields(client, auth_headers):
    response = await client.post(BASE, json=make_food_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Chicken Breast"
    assert body["source"] == "manual"
    assert "Location" in response.headers
    assert response.headers["Location"] == f"{BASE}/{body['id']}"


async def test_create_food_without_fiber(client, auth_headers):
    response = await client.post(BASE, json=make_food_payload(fiber_g=None), headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["fiber_g"] is None


async def test_create_food_with_negative_energy_returns_422(client, auth_headers):
    response = await client.post(BASE, json=make_food_payload(energy_kcal=-1), headers=auth_headers)
    assert response.status_code == 422


async def test_create_food_with_blank_name_returns_422(client, auth_headers):
    response = await client.post(BASE, json=make_food_payload(name="  "), headers=auth_headers)
    assert response.status_code == 422


async def test_get_food_detail(client, auth_headers):
    create_resp = await client.post(BASE, json=make_food_payload(), headers=auth_headers)
    food_id = create_resp.json()["id"]

    response = await client.get(f"{BASE}/{food_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == food_id


async def test_get_nonexistent_food_returns_404(client, auth_headers):
    response = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "FOOD_NOT_FOUND"


async def test_list_foods_pagination_and_ordering(client, auth_headers):
    for name in ["Zucchini", "Apple", "Banana"]:
        await client.post(BASE, json=make_food_payload(name=name), headers=auth_headers)

    response = await client.get(f"{BASE}?limit=2&offset=0", headers=auth_headers)
    body = response.json()
    assert body["total"] == 3
    assert [f["name"] for f in body["items"]] == ["Apple", "Banana"]


async def test_list_foods_filters_by_query(client, auth_headers):
    await client.post(
        BASE, json=make_food_payload(name="Greek Yogurt", brand="Fage"), headers=auth_headers
    )
    await client.post(BASE, json=make_food_payload(name="Chicken Breast"), headers=auth_headers)

    response = await client.get(f"{BASE}?q=yogurt", headers=auth_headers)
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "Greek Yogurt"

    response = await client.get(f"{BASE}?q=fage", headers=auth_headers)
    assert response.json()["total"] == 1


async def test_replace_food_updates_fields(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_food_payload(name="Old Name"), headers=auth_headers
    )
    food_id = create_resp.json()["id"]

    response = await client.put(
        f"{BASE}/{food_id}", json=make_food_payload(name="New Name"), headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


async def test_replace_nonexistent_food_returns_404(client, auth_headers):
    response = await client.put(
        f"{BASE}/{uuid.uuid4()}", json=make_food_payload(), headers=auth_headers
    )
    assert response.status_code == 404


async def test_delete_food(client, auth_headers):
    create_resp = await client.post(BASE, json=make_food_payload(), headers=auth_headers)
    food_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{BASE}/{food_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{BASE}/{food_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_nonexistent_food_returns_404(client, auth_headers):
    response = await client.delete(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404


async def test_invalid_uuid_path_param_returns_422(client, auth_headers):
    response = await client.get(f"{BASE}/not-a-uuid", headers=auth_headers)
    assert response.status_code == 422
