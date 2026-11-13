import uuid

BASE = "/api/v1/quick-add-presets"


def make_preset_payload(**overrides) -> dict:
    payload = {
        "name": "Flat white",
        "quantity": 160,
        "unit": "ml",
        "energy_kcal": 110,
        "protein_g": 6,
        "carbohydrate_g": 8.5,
        "fat_g": 5.5,
        "position": 2,
    }
    payload.update(overrides)
    return payload


async def test_create_list_replace_and_delete_a_preset(client, auth_headers):
    created = await client.post(BASE, json=make_preset_payload(), headers=auth_headers)
    assert created.status_code == 201
    preset = created.json()
    assert created.headers["Location"] == f"{BASE}/{preset['id']}"
    assert preset["fiber_g"] is None

    replaced = await client.put(
        f"{BASE}/{preset['id']}",
        json=make_preset_payload(name="Flat white oat", energy_kcal=95),
        headers=auth_headers,
    )
    assert replaced.status_code == 200
    assert (replaced.json()["name"], replaced.json()["energy_kcal"]) == ("Flat white oat", 95)

    listed = await client.get(BASE, headers=auth_headers)
    assert [item["name"] for item in listed.json()["items"]] == ["Flat white oat"]

    assert (await client.delete(f"{BASE}/{preset['id']}", headers=auth_headers)).status_code == 204
    assert (await client.get(BASE, headers=auth_headers)).json()["items"] == []


async def test_presets_are_listed_by_position_then_name(client, auth_headers):
    for name, position in (("Tea", 1), ("Espresso", 1), ("Cappuccino", 0)):
        await client.post(
            BASE, json=make_preset_payload(name=name, position=position), headers=auth_headers
        )

    listed = await client.get(BASE, headers=auth_headers)
    assert [item["name"] for item in listed.json()["items"]] == ["Cappuccino", "Espresso", "Tea"]


async def test_zero_calorie_preset_needs_only_name_quantity_and_energy(client, auth_headers):
    response = await client.post(
        BASE, json={"name": "Tea", "quantity": 250, "energy_kcal": 0}, headers=auth_headers
    )
    assert response.status_code == 201
    body = response.json()
    assert (body["unit"], body["protein_g"], body["carbohydrate_g"], body["fat_g"]) == (
        "ml",
        0,
        0,
        0,
    )


async def test_invalid_presets_return_422(client, auth_headers):
    for overrides in ({"name": "  "}, {"quantity": 0}, {"energy_kcal": -1}, {"unit": " "}):
        response = await client.post(
            BASE, json=make_preset_payload(**overrides), headers=auth_headers
        )
        assert response.status_code == 422, overrides


async def test_unknown_preset_returns_404(client, auth_headers):
    missing = f"{BASE}/{uuid.uuid4()}"
    put = await client.put(missing, json=make_preset_payload(), headers=auth_headers)
    assert put.status_code == 404
    assert put.json()["code"] == "QUICK_ADD_PRESET_NOT_FOUND"
    assert (await client.delete(missing, headers=auth_headers)).status_code == 404


async def test_editing_a_preset_keeps_drinks_already_logged(client, auth_headers):
    preset = (await client.post(BASE, json=make_preset_payload(), headers=auth_headers)).json()
    # The food logger logs a preset as an ad hoc meal item with its values.
    logged = await client.post(
        "/api/v1/meal-entries",
        json={
            "consumed_at": "2026-10-19T07:30:00Z",
            "meal_type": "breakfast",
            "items": [
                {
                    "food_id": None,
                    "quantity": preset["quantity"],
                    "unit": preset["unit"],
                    "food_name_snapshot": preset["name"],
                    "energy_kcal": preset["energy_kcal"],
                    "protein_g": preset["protein_g"],
                    "carbohydrate_g": preset["carbohydrate_g"],
                    "fat_g": preset["fat_g"],
                }
            ],
        },
        headers=auth_headers,
    )
    assert logged.status_code == 201

    await client.put(
        f"{BASE}/{preset['id']}", json=make_preset_payload(energy_kcal=200), headers=auth_headers
    )

    entry = (
        await client.get(f"/api/v1/meal-entries/{logged.json()['id']}", headers=auth_headers)
    ).json()
    assert entry["items"][0]["energy_kcal_snapshot"] == 110


async def test_presets_require_authentication(client):
    assert (await client.get(BASE)).status_code == 401
