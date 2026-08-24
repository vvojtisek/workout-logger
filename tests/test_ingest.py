BASE = "/api/v1/ingest"


def weight_payload(**overrides) -> dict:
    payload = {
        "measured_at": "2026-06-01T08:00:00Z",
        "weight_kg": 78.2,
        "source": "health_connect",
        "external_id": "hc-weight-1",
    }
    payload.update(overrides)
    return payload


def sleep_payload(**overrides) -> dict:
    payload = {
        "sleep_start": "2026-06-01T04:00:00Z",
        "sleep_end": "2026-06-01T12:00:00Z",
        "timezone": "America/New_York",
        "source": "health_connect",
        "external_id": "hc-sleep-1",
    }
    payload.update(overrides)
    return payload


def session_payload(**overrides) -> dict:
    payload = {
        "performed_at": "2026-06-01T09:00:00Z",
        "total_time_minutes": 45,
        "overall_feeling": 4,
        "source": "strava",
        "external_id": "strava-activity-1",
    }
    payload.update(overrides)
    return payload


def steps_payload(**overrides) -> dict:
    payload = {
        "recorded_date": "2026-06-01",
        "steps": 10432,
        "source": "health_connect",
        "external_id": "hc-steps-2026-06-01",
    }
    payload.update(overrides)
    return payload


async def test_ingest_weight_creates_a_body_metric(client, auth_headers):
    response = await client.post(f"{BASE}/weight", json=weight_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["created"] is True
    assert body["weight_kg"] == 78.2
    assert body["source"] == "health_connect"
    assert body["external_id"] == "hc-weight-1"

    rest = await client.get("/api/v1/body-metrics", headers=auth_headers)
    assert rest.json()["total"] == 1


async def test_ingest_weight_replay_is_idempotent(client, auth_headers):
    first = await client.post(f"{BASE}/weight", json=weight_payload(), headers=auth_headers)
    second = await client.post(f"{BASE}/weight", json=weight_payload(), headers=auth_headers)
    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert second.json()["created"] is False

    rest = await client.get("/api/v1/body-metrics", headers=auth_headers)
    assert rest.json()["total"] == 1


async def test_ingest_weight_different_external_id_creates_a_second_row(client, auth_headers):
    await client.post(f"{BASE}/weight", json=weight_payload(), headers=auth_headers)
    response = await client.post(
        f"{BASE}/weight", json=weight_payload(external_id="hc-weight-2"), headers=auth_headers
    )
    assert response.status_code == 201

    rest = await client.get("/api/v1/body-metrics", headers=auth_headers)
    assert rest.json()["total"] == 2


async def test_ingest_weight_same_external_id_different_source_creates_a_second_row(
    client, auth_headers
):
    await client.post(f"{BASE}/weight", json=weight_payload(), headers=auth_headers)
    response = await client.post(
        f"{BASE}/weight", json=weight_payload(source="garmin"), headers=auth_headers
    )
    assert response.status_code == 201

    rest = await client.get("/api/v1/body-metrics", headers=auth_headers)
    assert rest.json()["total"] == 2


async def test_ingest_weight_without_external_id_returns_422(client, auth_headers):
    payload = weight_payload()
    del payload["external_id"]
    response = await client.post(f"{BASE}/weight", json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_ingest_weight_with_blank_source_returns_422(client, auth_headers):
    response = await client.post(
        f"{BASE}/weight", json=weight_payload(source="   "), headers=auth_headers
    )
    assert response.status_code == 422


async def test_ingest_sleep_creates_an_entry_and_is_idempotent(client, auth_headers):
    first = await client.post(f"{BASE}/sleep", json=sleep_payload(), headers=auth_headers)
    assert first.status_code == 201
    assert first.json()["time_in_bed_seconds"] == 28_800
    assert first.json()["external_id"] == "hc-sleep-1"

    second = await client.post(f"{BASE}/sleep", json=sleep_payload(), headers=auth_headers)
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]

    rest = await client.get("/api/v1/sleep-entries", headers=auth_headers)
    assert rest.json()["total"] == 1


async def test_ingest_sleep_manual_entries_still_coexist_after_ingest(client, auth_headers):
    await client.post(f"{BASE}/sleep", json=sleep_payload(), headers=auth_headers)
    manual = await client.post(
        "/api/v1/sleep-entries",
        json={
            "sleep_start": "2026-06-02T04:00:00Z",
            "sleep_end": "2026-06-02T12:00:00Z",
            "timezone": "America/New_York",
        },
        headers=auth_headers,
    )
    assert manual.status_code == 201
    assert manual.json()["source"] == "manual"
    assert manual.json()["external_id"] is None

    rest = await client.get("/api/v1/sleep-entries", headers=auth_headers)
    assert rest.json()["total"] == 2


async def test_ingest_session_creates_a_workout_log_and_is_idempotent(client, auth_headers):
    first = await client.post(f"{BASE}/sessions", json=session_payload(), headers=auth_headers)
    assert first.status_code == 201
    assert first.json()["source"] == "strava"
    assert first.json()["total_time_minutes"] == 45

    second = await client.post(f"{BASE}/sessions", json=session_payload(), headers=auth_headers)
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]

    rest = await client.get("/api/v1/logs", headers=auth_headers)
    assert rest.json()["total"] == 1


async def test_ingest_session_with_exercises(client, auth_headers):
    payload = session_payload(
        exercises=[
            {
                "exercise_name": "Outdoor Run",
                "sets_count": 1,
                "reps_per_set": [1],
            }
        ]
    )
    response = await client.post(f"{BASE}/sessions", json=payload, headers=auth_headers)
    assert response.status_code == 201
    assert len(response.json()["exercises"]) == 1


async def test_ingest_steps_creates_a_row_and_is_idempotent(client, auth_headers):
    first = await client.post(f"{BASE}/steps", json=steps_payload(), headers=auth_headers)
    assert first.status_code == 201
    assert first.json()["steps"] == 10432
    assert first.json()["recorded_date"] == "2026-06-01"

    second = await client.post(f"{BASE}/steps", json=steps_payload(), headers=auth_headers)
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["created"] is False


async def test_ingest_steps_updated_total_for_the_same_day_uses_a_new_external_id(
    client, auth_headers
):
    await client.post(f"{BASE}/steps", json=steps_payload(steps=5000), headers=auth_headers)
    response = await client.post(
        f"{BASE}/steps",
        json=steps_payload(steps=10432, external_id="hc-steps-2026-06-01-update"),
        headers=auth_headers,
    )
    assert response.status_code == 201
    assert response.json()["steps"] == 10432


async def test_ingest_steps_negative_count_returns_422(client, auth_headers):
    response = await client.post(
        f"{BASE}/steps", json=steps_payload(steps=-1), headers=auth_headers
    )
    assert response.status_code == 422


async def test_ingest_requires_a_valid_api_key(client):
    response = await client.post(f"{BASE}/weight", json=weight_payload())
    assert response.status_code == 401


async def test_ingest_rejects_a_read_only_token(client, auth_headers):
    created = await client.post(
        "/api/v1/tokens",
        json={"name": "read-only", "scopes": ["read"]},
        headers=auth_headers,
    )
    read_only_key = created.json()["token"]
    response = await client.post(
        f"{BASE}/weight", json=weight_payload(), headers={"X-API-Key": read_only_key}
    )
    assert response.status_code == 403
