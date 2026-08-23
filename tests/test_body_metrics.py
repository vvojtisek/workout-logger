import uuid

BASE = "/api/v1/body-metrics"
TRENDS = f"{BASE}/trends"


def make_metric_payload(**overrides) -> dict:
    payload = {
        "measured_at": "2026-01-15T08:00:00Z",
        "weight_kg": 78.2,
        "body_fat_percent": 18.5,
        "neck_cm": 38,
        "chest_cm": 102,
        "waist_cm": 85,
        "hips_cm": 98,
        "biceps_cm": 35,
        "forearms_cm": 28,
        "thighs_cm": 58,
        "calves_cm": 38,
    }
    payload.update(overrides)
    return payload


async def test_create_body_metric_with_full_fields(client, auth_headers):
    response = await client.post(BASE, json=make_metric_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["weight_kg"] == 78.2
    assert body["waist_cm"] == 85
    assert "Location" in response.headers
    assert response.headers["Location"] == f"{BASE}/{body['id']}"


async def test_create_body_metric_with_only_weight(client, auth_headers):
    payload = make_metric_payload(
        body_fat_percent=None,
        neck_cm=None,
        chest_cm=None,
        waist_cm=None,
        hips_cm=None,
        biceps_cm=None,
        forearms_cm=None,
        thighs_cm=None,
        calves_cm=None,
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["body_fat_percent"] is None


async def test_create_body_metric_without_timezone_returns_422(client, auth_headers):
    payload = make_metric_payload(measured_at="2026-01-15T08:00:00")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_body_metric_with_negative_weight_returns_422(client, auth_headers):
    payload = make_metric_payload(weight_kg=-1)
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_body_metric_with_out_of_range_body_fat_returns_422(client, auth_headers):
    payload = make_metric_payload(body_fat_percent=150)
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_get_body_metric_detail(client, auth_headers):
    create_resp = await client.post(BASE, json=make_metric_payload(), headers=auth_headers)
    metric_id = create_resp.json()["id"]

    response = await client.get(f"{BASE}/{metric_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == metric_id


async def test_get_nonexistent_body_metric_returns_404(client, auth_headers):
    response = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "BODY_METRIC_NOT_FOUND"


async def test_list_body_metrics_pagination_and_ordering(client, auth_headers):
    for measured_at in ["2026-01-01T08:00:00Z", "2026-01-08T08:00:00Z", "2026-01-15T08:00:00Z"]:
        await client.post(
            BASE, json=make_metric_payload(measured_at=measured_at), headers=auth_headers
        )

    response = await client.get(f"{BASE}?limit=2&offset=0", headers=auth_headers)
    body = response.json()
    assert body["limit"] == 2
    assert body["total"] == 3
    assert [item["measured_at"] for item in body["items"]] == [
        "2026-01-15T08:00:00Z",
        "2026-01-08T08:00:00Z",
    ]


async def test_replace_body_metric_updates_fields(client, auth_headers):
    create_resp = await client.post(BASE, json=make_metric_payload(), headers=auth_headers)
    metric_id = create_resp.json()["id"]

    response = await client.put(
        f"{BASE}/{metric_id}",
        json=make_metric_payload(weight_kg=77.0),
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["weight_kg"] == 77.0


async def test_replace_nonexistent_body_metric_returns_404(client, auth_headers):
    response = await client.put(
        f"{BASE}/{uuid.uuid4()}", json=make_metric_payload(), headers=auth_headers
    )
    assert response.status_code == 404


async def test_delete_body_metric(client, auth_headers):
    create_resp = await client.post(BASE, json=make_metric_payload(), headers=auth_headers)
    metric_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{BASE}/{metric_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{BASE}/{metric_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_nonexistent_body_metric_returns_404(client, auth_headers):
    response = await client.delete(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404


async def test_invalid_uuid_path_param_returns_422(client, auth_headers):
    response = await client.get(f"{BASE}/not-a-uuid", headers=auth_headers)
    assert response.status_code == 422


async def test_trends_with_no_entries_returns_all_none(client, auth_headers):
    response = await client.get(TRENDS, headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {
        "latest": None,
        "weight_kg_delta_7d": None,
        "weight_kg_delta_14d": None,
        "body_fat_percent_delta_7d": None,
        "body_fat_percent_delta_14d": None,
    }


async def test_trends_with_single_entry_has_no_deltas(client, auth_headers):
    await client.post(BASE, json=make_metric_payload(), headers=auth_headers)
    response = await client.get(TRENDS, headers=auth_headers)
    body = response.json()
    assert body["latest"]["weight_kg"] == 78.2
    assert body["weight_kg_delta_7d"] is None
    assert body["weight_kg_delta_14d"] is None


async def test_trends_compute_7d_and_14d_weight_deltas(client, auth_headers):
    await client.post(
        BASE,
        json=make_metric_payload(measured_at="2026-01-01T08:00:00Z", weight_kg=80.0),
        headers=auth_headers,
    )
    await client.post(
        BASE,
        json=make_metric_payload(measured_at="2026-01-08T08:00:00Z", weight_kg=79.0),
        headers=auth_headers,
    )
    await client.post(
        BASE,
        json=make_metric_payload(measured_at="2026-01-15T08:00:00Z", weight_kg=78.2),
        headers=auth_headers,
    )

    response = await client.get(TRENDS, headers=auth_headers)
    body = response.json()
    assert body["latest"]["weight_kg"] == 78.2
    assert body["weight_kg_delta_7d"] == -0.8
    assert body["weight_kg_delta_14d"] == -1.8


async def test_trends_delta_is_none_when_metric_missing_on_either_endpoint(client, auth_headers):
    await client.post(
        BASE,
        json=make_metric_payload(measured_at="2026-01-01T08:00:00Z", body_fat_percent=None),
        headers=auth_headers,
    )
    await client.post(
        BASE,
        json=make_metric_payload(measured_at="2026-01-15T08:00:00Z", body_fat_percent=18.0),
        headers=auth_headers,
    )

    response = await client.get(TRENDS, headers=auth_headers)
    body = response.json()
    assert body["body_fat_percent_delta_14d"] is None


async def test_trends_delta_is_none_when_no_entry_far_enough_back(client, auth_headers):
    await client.post(
        BASE,
        json=make_metric_payload(measured_at="2026-01-08T08:00:00Z", weight_kg=79.0),
        headers=auth_headers,
    )
    await client.post(
        BASE,
        json=make_metric_payload(measured_at="2026-01-15T08:00:00Z", weight_kg=78.2),
        headers=auth_headers,
    )

    response = await client.get(TRENDS, headers=auth_headers)
    body = response.json()
    assert body["weight_kg_delta_14d"] is None
    assert body["weight_kg_delta_7d"] == -0.8
