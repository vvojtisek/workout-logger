BASE = "/api/v1/settings"


async def test_get_settings_creates_defaults_on_first_read(client, auth_headers):
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["units"] == "metric"
    assert body["default_rest_compound_seconds"] == 90
    assert body["default_rest_isolation_seconds"] == 60


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
    assert update.json()["units"] == "imperial"

    refetched = await client.get(BASE, headers=auth_headers)
    assert refetched.json() == update.json()


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
