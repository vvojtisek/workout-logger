BASE = "/api/v1/settings"


async def test_get_settings_creates_defaults_on_first_read(client, auth_headers):
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["units"] == "metric"
    assert body["default_rest_compound_seconds"] == 90
    assert body["default_rest_isolation_seconds"] == 60
    assert body["barbell_weight_kg"] == 20
    assert body["plate_inventory"][0] == {"plate_weight_kg": 25, "pairs": 4}
    assert body["active_equipment_profile_id"] == "barbell-default"
    assert body["equipment_profiles"][0]["name"] == "Barbell 20 kg"


async def test_get_settings_is_a_stable_singleton(client, auth_headers):
    first = await client.get(BASE, headers=auth_headers)
    second = await client.get(BASE, headers=auth_headers)
    assert first.json()["id"] == second.json()["id"]


async def test_update_settings_persists_and_is_returned_by_get(client, auth_headers):
    update = await client.put(
        BASE,
        json={
            "units": "imperial",
            "default_rest_compound_seconds": 120,
            "default_rest_isolation_seconds": 45,
        },
        headers=auth_headers,
    )
    assert update.status_code == 200
    assert update.json()["units"] == "metric"

    refetched = await client.get(BASE, headers=auth_headers)
    assert refetched.json() == update.json()


async def test_plate_inventory_settings_round_trip(client, auth_headers):
    payload = {
        "units": "metric",
        "default_rest_compound_seconds": 90,
        "default_rest_isolation_seconds": 60,
        "barbell_weight_kg": 15,
        "plate_inventory": [
            {"plate_weight_kg": 5, "pairs": 2},
            {"plate_weight_kg": 1.25, "pairs": 4},
        ],
    }
    response = await client.put(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["barbell_weight_kg"] == 15
    assert response.json()["plate_inventory"] == payload["plate_inventory"]

    refetched = await client.get(BASE, headers=auth_headers)
    assert refetched.json()["barbell_weight_kg"] == 15
    assert refetched.json()["plate_inventory"] == payload["plate_inventory"]


async def test_equipment_profiles_round_trip_and_select_active_profile(client, auth_headers):
    profiles = [
        {
            "id": "olympic-20",
            "name": "Olympic bar",
            "barbell_weight_kg": 20,
            "plate_inventory": [{"plate_weight_kg": 20, "pairs": 2}],
        },
        {
            "id": "technique-15",
            "name": "Technique bar",
            "barbell_weight_kg": 15,
            "plate_inventory": [{"plate_weight_kg": 10, "pairs": 2}],
        },
    ]
    response = await client.put(
        BASE,
        json={
            "default_rest_compound_seconds": 90,
            "default_rest_isolation_seconds": 60,
            "equipment_profiles": profiles,
            "active_equipment_profile_id": "technique-15",
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["equipment_profiles"] == profiles
    assert response.json()["active_equipment_profile_id"] == "technique-15"
    assert response.json()["barbell_weight_kg"] == 15
    assert response.json()["plate_inventory"] == profiles[1]["plate_inventory"]

    refetched = await client.get(BASE, headers=auth_headers)
    assert refetched.json()["equipment_profiles"] == profiles
    assert refetched.json()["active_equipment_profile_id"] == "technique-15"


async def test_equipment_profiles_reject_duplicate_ids_and_unknown_active_id(client, auth_headers):
    profile = {
        "id": "oly",
        "name": "Olympic bar",
        "barbell_weight_kg": 20,
        "plate_inventory": [{"plate_weight_kg": 5, "pairs": 2}],
    }
    for profiles, active_id in (([profile, profile], "oly"), ([profile], "missing")):
        response = await client.put(
            BASE,
            json={
                "default_rest_compound_seconds": 90,
                "default_rest_isolation_seconds": 60,
                "equipment_profiles": profiles,
                "active_equipment_profile_id": active_id,
            },
            headers=auth_headers,
        )
        assert response.status_code == 422


async def test_plate_inventory_rejects_invalid_counts(client, auth_headers):
    response = await client.put(
        BASE,
        json={
            "units": "metric",
            "default_rest_compound_seconds": 90,
            "default_rest_isolation_seconds": 60,
            "barbell_weight_kg": 20,
            "plate_inventory": [{"plate_weight_kg": 2.5, "pairs": -1}],
        },
        headers=auth_headers,
    )
    assert response.status_code == 422


async def test_update_settings_with_invalid_units_returns_422(client, auth_headers):
    response = await client.put(
        BASE,
        json={
            "units": "furlongs",
            "default_rest_compound_seconds": 90,
            "default_rest_isolation_seconds": 60,
        },
        headers=auth_headers,
    )
    assert response.status_code == 422


async def test_update_settings_with_out_of_range_rest_returns_422(client, auth_headers):
    response = await client.put(
        BASE,
        json={
            "units": "metric",
            "default_rest_compound_seconds": 99999,
            "default_rest_isolation_seconds": 60,
        },
        headers=auth_headers,
    )
    assert response.status_code == 422


async def test_settings_requires_authentication(client):
    response = await client.get(BASE)
    assert response.status_code == 401
