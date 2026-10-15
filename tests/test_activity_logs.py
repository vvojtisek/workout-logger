LOGS = "/api/v1/logs"


def activity_payload(**overrides) -> dict:
    payload = {
        "performed_at": "2026-10-14T19:30:00Z",
        "total_time_minutes": 75,
        "overall_feeling": 4,
        "activity_type": "ice_hockey",
        "effort_rpe": 7,
        "notes": "League game, 3 shifts short",
    }
    payload.update(overrides)
    return payload


async def test_log_ice_hockey_without_exercises(client, auth_headers):
    response = await client.post(LOGS, json=activity_payload(), headers=auth_headers)

    assert response.status_code == 201
    body = response.json()
    assert body["activity_type"] == "ice_hockey"
    assert body["effort_rpe"] == 7
    assert body["distance_km"] is None
    assert body["exercises"] == []
    assert body["source"] == "manual"

    listed = await client.get(LOGS, headers=auth_headers)
    item = listed.json()["items"][0]
    assert item["activity_type"] == "ice_hockey"
    assert item["effort_rpe"] == 7


async def test_log_swim_with_distance_and_replace(client, auth_headers):
    created = await client.post(
        LOGS,
        json=activity_payload(activity_type="swimming", distance_km=1.5, effort_rpe=5),
        headers=auth_headers,
    )
    assert created.status_code == 201
    log_id = created.json()["id"]

    replaced = await client.put(
        f"{LOGS}/{log_id}",
        json=activity_payload(activity_type="swimming", distance_km=2.0, effort_rpe=None),
        headers=auth_headers,
    )

    assert replaced.status_code == 200
    assert replaced.json()["distance_km"] == 2.0
    assert replaced.json()["effort_rpe"] is None


async def test_strength_logs_have_no_activity_fields(client, auth_headers):
    response = await client.post(
        LOGS,
        json={
            "performed_at": "2026-10-14T08:00:00Z",
            "total_time_minutes": 30,
            "overall_feeling": 3,
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["activity_type"] is None
    assert body["distance_km"] is None
    assert body["effort_rpe"] is None


async def test_activity_fields_are_validated(client, auth_headers):
    for overrides in (
        {"activity_type": "quidditch"},
        {"effort_rpe": 0},
        {"effort_rpe": 11},
        {"distance_km": -1},
        {"distance_km": 1001},
    ):
        response = await client.post(LOGS, json=activity_payload(**overrides), headers=auth_headers)
        assert response.status_code == 422, overrides


async def test_synced_sessions_can_carry_an_activity_type(client, auth_headers):
    response = await client.post(
        "/api/v1/ingest/sessions",
        json=activity_payload(source="health_connect", external_id="hc-hockey-1"),
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["activity_type"] == "ice_hockey"
