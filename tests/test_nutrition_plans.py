import uuid

BASE = "/api/v1/nutrition-plans"


def make_plan_payload(**overrides) -> dict:
    payload = {
        "name": "Cut",
        "valid_from": "2026-01-01",
        "valid_to": "2026-03-01",
        "energy_target_kcal": 2000,
        "protein_target_g": 150,
        "carbohydrate_target_g": 200,
        "fat_target_g": 60,
        "fiber_target_g": 30,
    }
    payload.update(overrides)
    return payload


async def test_create_nutrition_plan_with_full_fields(client, auth_headers):
    response = await client.post(BASE, json=make_plan_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Cut"
    assert "Location" in response.headers


async def test_create_nutrition_plan_without_end_date(client, auth_headers):
    response = await client.post(BASE, json=make_plan_payload(valid_to=None), headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["valid_to"] is None


async def test_create_nutrition_plan_with_end_before_start_returns_422(client, auth_headers):
    response = await client.post(
        BASE,
        json=make_plan_payload(valid_from="2026-03-01", valid_to="2026-01-01"),
        headers=auth_headers,
    )
    assert response.status_code == 422


async def test_create_nutrition_plan_with_blank_name_returns_422(client, auth_headers):
    response = await client.post(BASE, json=make_plan_payload(name="  "), headers=auth_headers)
    assert response.status_code == 422


async def test_overlapping_nutrition_plans_are_allowed(client, auth_headers):
    first = await client.post(BASE, json=make_plan_payload(name="Cut"), headers=auth_headers)
    second = await client.post(
        BASE, json=make_plan_payload(name="Bulk", valid_from="2026-02-01"), headers=auth_headers
    )
    assert first.status_code == 201
    assert second.status_code == 201


async def test_get_nutrition_plan_detail(client, auth_headers):
    create_resp = await client.post(BASE, json=make_plan_payload(), headers=auth_headers)
    plan_id = create_resp.json()["id"]

    response = await client.get(f"{BASE}/{plan_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == plan_id


async def test_get_nonexistent_nutrition_plan_returns_404(client, auth_headers):
    response = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "NUTRITION_PLAN_NOT_FOUND"


async def test_list_nutrition_plans_pagination(client, auth_headers):
    for name, start in [("A", "2026-01-01"), ("B", "2026-02-01"), ("C", "2026-03-01")]:
        await client.post(
            BASE,
            json=make_plan_payload(name=name, valid_from=start, valid_to=None),
            headers=auth_headers,
        )

    response = await client.get(f"{BASE}?limit=2&offset=0", headers=auth_headers)
    body = response.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2


async def test_replace_nutrition_plan_updates_fields(client, auth_headers):
    create_resp = await client.post(BASE, json=make_plan_payload(name="Old"), headers=auth_headers)
    plan_id = create_resp.json()["id"]

    response = await client.put(
        f"{BASE}/{plan_id}",
        json=make_plan_payload(name="New", energy_target_kcal=2200),
        headers=auth_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New"
    assert body["energy_target_kcal"] == 2200


async def test_replace_nonexistent_nutrition_plan_returns_404(client, auth_headers):
    response = await client.put(
        f"{BASE}/{uuid.uuid4()}", json=make_plan_payload(), headers=auth_headers
    )
    assert response.status_code == 404


async def test_delete_nutrition_plan(client, auth_headers):
    create_resp = await client.post(BASE, json=make_plan_payload(), headers=auth_headers)
    plan_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{BASE}/{plan_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{BASE}/{plan_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_nonexistent_nutrition_plan_returns_404(client, auth_headers):
    response = await client.delete(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404


async def test_invalid_uuid_path_param_returns_422(client, auth_headers):
    response = await client.get(f"{BASE}/not-a-uuid", headers=auth_headers)
    assert response.status_code == 422
