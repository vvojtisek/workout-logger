import uuid

BASE = "/api/v1/sleep-entries"
TRENDS = f"{BASE}/trends"


def make_entry_payload(**overrides) -> dict:
    payload = {
        "sleep_start": "2026-01-16T04:00:00Z",
        "sleep_end": "2026-01-16T12:00:00Z",
        "timezone": "America/New_York",
        "estimated_sleep_seconds": 25200,
        "awake_seconds": 600,
        "quality_score": 4,
        "resting_heart_rate": 58,
        "notes": "Slept well",
    }
    payload.update(overrides)
    return payload


async def test_create_sleep_entry_computes_time_in_bed_seconds(client, auth_headers):
    response = await client.post(BASE, json=make_entry_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["time_in_bed_seconds"] == 28800
    assert "Location" in response.headers
    assert response.headers["Location"] == f"{BASE}/{body['id']}"


async def test_create_sleep_entry_attributes_overnight_entry_to_wake_date(client, auth_headers):
    # 23:00 Jan 15 -> 07:00 Jan 16 local (America/New_York, EST = UTC-5).
    payload = make_entry_payload(
        sleep_start="2026-01-16T04:00:00Z", sleep_end="2026-01-16T12:00:00Z"
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["sleep_date"] == "2026-01-16"


async def test_create_sleep_entry_with_minimal_fields(client, auth_headers):
    payload = make_entry_payload(
        estimated_sleep_seconds=None,
        awake_seconds=None,
        quality_score=None,
        resting_heart_rate=None,
        notes=None,
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["source"] == "manual"


async def test_create_sleep_entry_with_end_before_start_returns_422(client, auth_headers):
    payload = make_entry_payload(
        sleep_start="2026-01-16T12:00:00Z", sleep_end="2026-01-16T04:00:00Z"
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_sleep_entry_with_equal_start_and_end_returns_422(client, auth_headers):
    payload = make_entry_payload(
        sleep_start="2026-01-16T04:00:00Z", sleep_end="2026-01-16T04:00:00Z"
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_sleep_entry_with_invalid_timezone_returns_422(client, auth_headers):
    payload = make_entry_payload(timezone="Not/AZone")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_sleep_entry_without_timezone_offset_returns_422(client, auth_headers):
    payload = make_entry_payload(sleep_start="2026-01-16T04:00:00")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_sleep_entry_with_invalid_quality_score_returns_422(client, auth_headers):
    payload = make_entry_payload(quality_score=6)
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_get_sleep_entry_detail(client, auth_headers):
    create_resp = await client.post(BASE, json=make_entry_payload(), headers=auth_headers)
    entry_id = create_resp.json()["id"]

    response = await client.get(f"{BASE}/{entry_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == entry_id


async def test_get_nonexistent_sleep_entry_returns_404(client, auth_headers):
    response = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "SLEEP_ENTRY_NOT_FOUND"


async def test_list_sleep_entries_pagination_and_ordering(client, auth_headers):
    for sleep_start, sleep_end in [
        ("2026-01-02T04:00:00Z", "2026-01-02T12:00:00Z"),
        ("2026-01-09T04:00:00Z", "2026-01-09T12:00:00Z"),
        ("2026-01-16T04:00:00Z", "2026-01-16T12:00:00Z"),
    ]:
        await client.post(
            BASE,
            json=make_entry_payload(sleep_start=sleep_start, sleep_end=sleep_end),
            headers=auth_headers,
        )

    response = await client.get(f"{BASE}?limit=2&offset=0", headers=auth_headers)
    body = response.json()
    assert body["total"] == 3
    assert [e["sleep_date"] for e in body["items"]] == ["2026-01-16", "2026-01-09"]


async def test_replace_sleep_entry_recomputes_time_in_bed_seconds(client, auth_headers):
    create_resp = await client.post(BASE, json=make_entry_payload(), headers=auth_headers)
    entry_id = create_resp.json()["id"]

    replace_payload = make_entry_payload(sleep_end="2026-01-16T11:00:00Z")
    response = await client.put(f"{BASE}/{entry_id}", json=replace_payload, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["time_in_bed_seconds"] == 25200


async def test_replace_nonexistent_sleep_entry_returns_404(client, auth_headers):
    response = await client.put(
        f"{BASE}/{uuid.uuid4()}", json=make_entry_payload(), headers=auth_headers
    )
    assert response.status_code == 404


async def test_delete_sleep_entry(client, auth_headers):
    create_resp = await client.post(BASE, json=make_entry_payload(), headers=auth_headers)
    entry_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{BASE}/{entry_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{BASE}/{entry_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_nonexistent_sleep_entry_returns_404(client, auth_headers):
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
        "average_sleep_seconds_7d": None,
        "average_sleep_seconds_30d": None,
        "average_quality_score_7d": None,
        "average_quality_score_30d": None,
    }


async def test_trends_with_single_entry_averages_equal_its_own_values(client, auth_headers):
    await client.post(BASE, json=make_entry_payload(), headers=auth_headers)
    response = await client.get(TRENDS, headers=auth_headers)
    body = response.json()
    assert body["average_sleep_seconds_7d"] == 25200
    assert body["average_sleep_seconds_30d"] == 25200
    assert body["average_quality_score_7d"] == 4
    assert body["average_quality_score_30d"] == 4


async def test_trends_7d_window_excludes_entry_exactly_seven_days_before_anchor(
    client, auth_headers
):
    # Anchor (latest) wakes on Jan 16. An entry waking on Jan 9 is exactly 7
    # days earlier and must fall outside the 7-day window (anchor-6..anchor)
    # while still counting toward the 30-day window.
    await client.post(
        BASE,
        json=make_entry_payload(
            sleep_start="2026-01-09T04:00:00Z",
            sleep_end="2026-01-09T12:00:00Z",
            estimated_sleep_seconds=28_800,
        ),
        headers=auth_headers,
    )
    await client.post(
        BASE,
        json=make_entry_payload(
            sleep_start="2026-01-16T04:00:00Z",
            sleep_end="2026-01-16T12:00:00Z",
            estimated_sleep_seconds=25_200,
        ),
        headers=auth_headers,
    )

    response = await client.get(TRENDS, headers=auth_headers)
    body = response.json()
    assert body["average_sleep_seconds_7d"] == 25_200
    assert body["average_sleep_seconds_30d"] == 27_000


async def test_trends_duration_falls_back_to_time_in_bed_when_no_estimate(client, auth_headers):
    await client.post(
        BASE, json=make_entry_payload(estimated_sleep_seconds=None), headers=auth_headers
    )
    response = await client.get(TRENDS, headers=auth_headers)
    # time_in_bed_seconds for the fixture payload is 8h = 28800.
    assert response.json()["average_sleep_seconds_7d"] == 28_800


async def test_trends_quality_average_ignores_entries_without_a_score(client, auth_headers):
    await client.post(
        BASE,
        json=make_entry_payload(
            sleep_start="2026-01-15T04:00:00Z",
            sleep_end="2026-01-15T12:00:00Z",
            quality_score=None,
        ),
        headers=auth_headers,
    )
    await client.post(
        BASE,
        json=make_entry_payload(
            sleep_start="2026-01-16T04:00:00Z",
            sleep_end="2026-01-16T12:00:00Z",
            quality_score=4,
        ),
        headers=auth_headers,
    )

    response = await client.get(TRENDS, headers=auth_headers)
    assert response.json()["average_quality_score_7d"] == 4


async def test_overnight_boundary_in_a_positive_utc_offset_timezone(client, auth_headers):
    # 00:30 local Jan 16 in Tokyo (UTC+9) is 2026-01-15T15:30:00Z — the wake
    # date must still be Jan 16 local, not Jan 15 (the UTC storage date).
    payload = make_entry_payload(
        sleep_start="2026-01-15T15:00:00Z",
        sleep_end="2026-01-15T23:00:00Z",
        timezone="Asia/Tokyo",
    )
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["sleep_date"] == "2026-01-16"
