BASE = "/api/v1/locations"


def make_location_payload(**overrides) -> dict:
    payload = {
        "name": "Office",
        "kind": "office",
        "equipment": ["dumbbell", "bench", "band"],
        "default_minutes": 30,
    }
    payload.update(overrides)
    return payload


async def test_create_location_normalizes_equipment(client, auth_headers):
    payload = make_location_payload(equipment=["dumbbell", "bench", "dumbbell", "bodyweight"])
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Office"
    assert body["kind"] == "office"
    # Sorted, unique, and without bodyweight, which every place has.
    assert body["equipment"] == ["bench", "dumbbell"]
    assert body["default_minutes"] == 30
    assert response.headers["Location"] == f"{BASE}/{body['id']}"


async def test_location_defaults(client, auth_headers):
    response = await client.post(
        BASE, json={"name": "Hotel", "kind": "travel"}, headers=auth_headers
    )
    assert response.status_code == 201
    assert response.json()["equipment"] == []
    assert response.json()["default_minutes"] is None


async def test_list_locations_sorted_by_name(client, auth_headers):
    for name in ("Home", "Gym", "Office"):
        created = await client.post(
            BASE, json=make_location_payload(name=name, kind="home"), headers=auth_headers
        )
        assert created.status_code == 201
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    assert [item["name"] for item in response.json()["items"]] == ["Gym", "Home", "Office"]
    assert response.json()["total"] == 3


async def test_duplicate_location_name_returns_409(client, auth_headers):
    first = await client.post(BASE, json=make_location_payload(), headers=auth_headers)
    assert first.status_code == 201
    second = await client.post(
        BASE, json=make_location_payload(name="office"), headers=auth_headers
    )
    assert second.status_code == 409
    assert second.json()["code"] == "LOCATION_NAME_CONFLICT"


async def test_replace_location(client, auth_headers):
    created = await client.post(BASE, json=make_location_payload(), headers=auth_headers)
    location_id = created.json()["id"]
    response = await client.put(
        f"{BASE}/{location_id}",
        json=make_location_payload(name="Work", equipment=["kettlebell"], default_minutes=None),
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Work"
    assert response.json()["equipment"] == ["kettlebell"]
    assert response.json()["default_minutes"] is None


async def test_replace_location_to_an_existing_name_returns_409(client, auth_headers):
    await client.post(BASE, json=make_location_payload(name="Gym"), headers=auth_headers)
    created = await client.post(BASE, json=make_location_payload(), headers=auth_headers)
    response = await client.put(
        f"{BASE}/{created.json()['id']}",
        json=make_location_payload(name="Gym"),
        headers=auth_headers,
    )
    assert response.status_code == 409


async def test_delete_location(client, auth_headers):
    created = await client.post(BASE, json=make_location_payload(), headers=auth_headers)
    location_id = created.json()["id"]
    deleted = await client.delete(f"{BASE}/{location_id}", headers=auth_headers)
    assert deleted.status_code == 204
    missing = await client.get(f"{BASE}/{location_id}", headers=auth_headers)
    assert missing.status_code == 404
    assert missing.json()["code"] == "LOCATION_NOT_FOUND"


async def test_unknown_equipment_tag_returns_422(client, auth_headers):
    response = await client.post(
        BASE, json=make_location_payload(equipment=["sandbag"]), headers=auth_headers
    )
    assert response.status_code == 422


async def test_unknown_kind_returns_422(client, auth_headers):
    response = await client.post(
        BASE, json=make_location_payload(kind="beach"), headers=auth_headers
    )
    assert response.status_code == 422


async def test_blank_name_returns_422(client, auth_headers):
    response = await client.post(BASE, json=make_location_payload(name="  "), headers=auth_headers)
    assert response.status_code == 422


async def test_default_minutes_out_of_range_returns_422(client, auth_headers):
    for minutes in (0, 600):
        response = await client.post(
            BASE, json=make_location_payload(default_minutes=minutes), headers=auth_headers
        )
        assert response.status_code == 422
