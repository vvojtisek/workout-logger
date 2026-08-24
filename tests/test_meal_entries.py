import uuid

BASE = "/api/v1/meal-entries"
FOODS = "/api/v1/foods"
PLANS = "/api/v1/nutrition-plans"
DAILY = "/api/v1/nutrition/daily"


async def create_food(client, auth_headers, **overrides) -> str:
    payload = {
        "name": "Chicken Breast",
        "serving_quantity": 100,
        "serving_unit": "g",
        "energy_kcal": 165,
        "protein_g": 31,
        "carbohydrate_g": 0,
        "fat_g": 3.6,
        "fiber_g": 0,
    }
    payload.update(overrides)
    response = await client.post(FOODS, json=payload, headers=auth_headers)
    assert response.status_code == 201
    return response.json()["id"]


def make_entry_payload(**overrides) -> dict:
    payload = {
        "consumed_at": "2026-01-15T08:00:00Z",
        "meal_type": "breakfast",
        "notes": None,
        "items": [
            {
                "quantity": 1,
                "unit": "cup",
                "food_name_snapshot": "Oatmeal",
                "energy_kcal": 150,
                "protein_g": 5,
                "carbohydrate_g": 27,
                "fat_g": 3,
                "fiber_g": 4,
            }
        ],
    }
    payload.update(overrides)
    return payload


async def test_create_meal_entry_with_food_reference_scales_snapshot(client, auth_headers):
    food_id = await create_food(client, auth_headers)
    payload = make_entry_payload(items=[{"food_id": food_id, "quantity": 150}])

    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    item = response.json()["items"][0]
    assert item["food_id"] == food_id
    assert item["food_name_snapshot"] == "Chicken Breast"
    assert item["unit"] == "g"
    assert item["energy_kcal_snapshot"] == 247.5
    assert item["protein_g_snapshot"] == 46.5
    assert item["fat_g_snapshot"] == 5.4


async def test_create_meal_entry_with_ad_hoc_item(client, auth_headers):
    response = await client.post(BASE, json=make_entry_payload(), headers=auth_headers)
    assert response.status_code == 201
    item = response.json()["items"][0]
    assert item["food_id"] is None
    assert item["food_name_snapshot"] == "Oatmeal"
    assert item["energy_kcal_snapshot"] == 150


async def test_create_meal_entry_with_multiple_items(client, auth_headers):
    food_id = await create_food(client, auth_headers)
    payload = make_entry_payload(
        items=[
            {"food_id": food_id, "quantity": 100},
            {
                "quantity": 2,
                "unit": "slice",
                "food_name_snapshot": "Toast",
                "energy_kcal": 80,
                "protein_g": 3,
                "carbohydrate_g": 15,
                "fat_g": 1,
            },
        ]
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    assert len(response.json()["items"]) == 2


async def test_create_meal_entry_ad_hoc_missing_required_field_returns_422(client, auth_headers):
    payload = make_entry_payload(
        items=[{"quantity": 1, "unit": "cup", "food_name_snapshot": "Oatmeal", "energy_kcal": 150}]
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_meal_entry_with_no_items_returns_422(client, auth_headers):
    payload = make_entry_payload(items=[])
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_meal_entry_with_nonexistent_food_returns_404(client, auth_headers):
    payload = make_entry_payload(items=[{"food_id": str(uuid.uuid4()), "quantity": 100}])
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "FOOD_NOT_FOUND"


async def test_create_meal_entry_without_timezone_returns_422(client, auth_headers):
    payload = make_entry_payload(consumed_at="2026-01-15T08:00:00")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_meal_entry_with_invalid_meal_type_returns_422(client, auth_headers):
    payload = make_entry_payload(meal_type="brunch")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_deleting_food_preserves_meal_item_snapshot(client, auth_headers):
    food_id = await create_food(client, auth_headers)
    payload = make_entry_payload(items=[{"food_id": food_id, "quantity": 150}])
    create_resp = await client.post(BASE, json=payload, headers=auth_headers)
    entry_id = create_resp.json()["id"]

    await client.delete(f"{FOODS}/{food_id}", headers=auth_headers)

    response = await client.get(f"{BASE}/{entry_id}", headers=auth_headers)
    item = response.json()["items"][0]
    assert item["food_id"] is None
    assert item["food_name_snapshot"] == "Chicken Breast"
    assert item["energy_kcal_snapshot"] == 247.5


async def test_get_meal_entry_detail(client, auth_headers):
    create_resp = await client.post(BASE, json=make_entry_payload(), headers=auth_headers)
    entry_id = create_resp.json()["id"]

    response = await client.get(f"{BASE}/{entry_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == entry_id


async def test_get_nonexistent_meal_entry_returns_404(client, auth_headers):
    response = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "MEAL_ENTRY_NOT_FOUND"


async def test_list_meal_entries_pagination_and_ordering(client, auth_headers):
    for consumed_at in ["2026-01-01T08:00:00Z", "2026-01-08T08:00:00Z", "2026-01-15T08:00:00Z"]:
        await client.post(
            BASE, json=make_entry_payload(consumed_at=consumed_at), headers=auth_headers
        )

    response = await client.get(f"{BASE}?limit=2&offset=0", headers=auth_headers)
    body = response.json()
    assert body["total"] == 3
    assert [e["consumed_at"] for e in body["items"]] == [
        "2026-01-15T08:00:00Z",
        "2026-01-08T08:00:00Z",
    ]


async def test_replace_meal_entry_replaces_items(client, auth_headers):
    create_resp = await client.post(BASE, json=make_entry_payload(), headers=auth_headers)
    entry_id = create_resp.json()["id"]

    replace_payload = make_entry_payload(
        meal_type="lunch",
        items=[
            {
                "quantity": 1,
                "unit": "each",
                "food_name_snapshot": "Sandwich",
                "energy_kcal": 400,
                "protein_g": 20,
                "carbohydrate_g": 40,
                "fat_g": 15,
            }
        ],
    )
    response = await client.put(f"{BASE}/{entry_id}", json=replace_payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["meal_type"] == "lunch"
    assert len(body["items"]) == 1
    assert body["items"][0]["food_name_snapshot"] == "Sandwich"


async def test_replace_nonexistent_meal_entry_returns_404(client, auth_headers):
    response = await client.put(
        f"{BASE}/{uuid.uuid4()}", json=make_entry_payload(), headers=auth_headers
    )
    assert response.status_code == 404


async def test_delete_meal_entry_cascades_items(client, auth_headers):
    create_resp = await client.post(BASE, json=make_entry_payload(), headers=auth_headers)
    entry_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{BASE}/{entry_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{BASE}/{entry_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_nonexistent_meal_entry_returns_404(client, auth_headers):
    response = await client.delete(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404


async def test_invalid_uuid_path_param_returns_422(client, auth_headers):
    response = await client.get(f"{BASE}/not-a-uuid", headers=auth_headers)
    assert response.status_code == 422


async def test_daily_summary_with_no_entries_and_no_plan(client, auth_headers):
    response = await client.get(f"{DAILY}?date=2026-01-15", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["totals"] == {
        "energy_kcal": 0,
        "protein_g": 0,
        "carbohydrate_g": 0,
        "fat_g": 0,
        "fiber_g": 0,
    }
    assert body["target"] is None
    assert body["remaining"] is None


async def test_daily_summary_sums_items_across_entries_for_the_day(client, auth_headers):
    await client.post(
        BASE,
        json=make_entry_payload(consumed_at="2026-01-15T08:00:00Z", meal_type="breakfast"),
        headers=auth_headers,
    )
    await client.post(
        BASE,
        json=make_entry_payload(consumed_at="2026-01-15T18:00:00Z", meal_type="dinner"),
        headers=auth_headers,
    )
    # A different day must not be included.
    await client.post(
        BASE,
        json=make_entry_payload(consumed_at="2026-01-16T08:00:00Z"),
        headers=auth_headers,
    )

    response = await client.get(f"{DAILY}?date=2026-01-15", headers=auth_headers)
    body = response.json()
    assert body["totals"]["energy_kcal"] == 300
    assert body["totals"]["protein_g"] == 10


async def test_daily_summary_computes_remaining_against_applicable_plan(client, auth_headers):
    await client.post(
        PLANS,
        json={
            "name": "Cut",
            "valid_from": "2026-01-01",
            "valid_to": "2026-03-01",
            "energy_target_kcal": 2000,
            "protein_target_g": 150,
            "carbohydrate_target_g": 200,
            "fat_target_g": 60,
            "fiber_target_g": 30,
        },
        headers=auth_headers,
    )
    await client.post(
        BASE,
        json=make_entry_payload(consumed_at="2026-01-15T08:00:00Z"),
        headers=auth_headers,
    )

    response = await client.get(f"{DAILY}?date=2026-01-15", headers=auth_headers)
    body = response.json()
    assert body["target"]["name"] == "Cut"
    assert body["remaining"]["energy_kcal"] == 1850
    assert body["remaining"]["fiber_g"] == 26


async def test_daily_summary_picks_most_recently_started_overlapping_plan(client, auth_headers):
    await client.post(
        PLANS,
        json={
            "name": "Old Plan",
            "valid_from": "2026-01-01",
            "energy_target_kcal": 1800,
            "protein_target_g": 140,
            "carbohydrate_target_g": 180,
            "fat_target_g": 50,
        },
        headers=auth_headers,
    )
    await client.post(
        PLANS,
        json={
            "name": "New Plan",
            "valid_from": "2026-01-10",
            "energy_target_kcal": 2200,
            "protein_target_g": 170,
            "carbohydrate_target_g": 220,
            "fat_target_g": 70,
        },
        headers=auth_headers,
    )

    response = await client.get(f"{DAILY}?date=2026-01-15", headers=auth_headers)
    assert response.json()["target"]["name"] == "New Plan"


async def test_daily_summary_remaining_fiber_is_none_when_plan_has_no_fiber_target(
    client, auth_headers
):
    await client.post(
        PLANS,
        json={
            "name": "No Fiber Target",
            "valid_from": "2026-01-01",
            "energy_target_kcal": 2000,
            "protein_target_g": 150,
            "carbohydrate_target_g": 200,
            "fat_target_g": 60,
        },
        headers=auth_headers,
    )
    response = await client.get(f"{DAILY}?date=2026-01-15", headers=auth_headers)
    assert response.json()["remaining"]["fiber_g"] is None
