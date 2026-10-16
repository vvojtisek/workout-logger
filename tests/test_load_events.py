BASE = "/api/v1/load-events"
CALENDAR = "/api/v1/calendar"


def make_payload(**overrides) -> dict:
    payload = {
        "name": "League game",
        "kind": "game",
        "weekday": 5,
        "start_time": "19:30",
        "duration_minutes": 75,
        "season_start": "2026-09-01",
        "season_end": "2027-03-31",
    }
    payload.update(overrides)
    return payload


async def test_create_load_event(client, auth_headers):
    response = await client.post(BASE, json=make_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "League game"
    assert body["kind"] == "game"
    assert body["weekday"] == 5
    assert body["start_time"] == "19:30:00"
    assert body["duration_minutes"] == 75
    assert body["season_start"] == "2026-09-01"
    assert body["season_end"] == "2027-03-31"
    assert response.headers["Location"] == f"{BASE}/{body['id']}"


async def test_duration_defaults_to_an_hour(client, auth_headers):
    payload = make_payload(kind="practice")
    del payload["duration_minutes"]
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["duration_minutes"] == 60


async def test_list_load_events_sorted_by_weekday_then_time(client, auth_headers):
    for weekday, start_time in ((5, "19:30"), (1, "20:00"), (1, "06:30")):
        created = await client.post(
            BASE,
            json=make_payload(weekday=weekday, start_time=start_time),
            headers=auth_headers,
        )
        assert created.status_code == 201
    response = await client.get(BASE, headers=auth_headers)
    assert response.status_code == 200
    items = response.json()["items"]
    assert [(item["weekday"], item["start_time"]) for item in items] == [
        (1, "06:30:00"),
        (1, "20:00:00"),
        (5, "19:30:00"),
    ]
    assert response.json()["total"] == 3


async def test_replace_and_delete_load_event(client, auth_headers):
    created = await client.post(BASE, json=make_payload(), headers=auth_headers)
    event_id = created.json()["id"]
    replaced = await client.put(
        f"{BASE}/{event_id}",
        json=make_payload(name="Practice", kind="practice", weekday=2),
        headers=auth_headers,
    )
    assert replaced.status_code == 200
    assert replaced.json()["kind"] == "practice"
    assert replaced.json()["weekday"] == 2

    deleted = await client.delete(f"{BASE}/{event_id}", headers=auth_headers)
    assert deleted.status_code == 204
    missing = await client.get(f"{BASE}/{event_id}", headers=auth_headers)
    assert missing.status_code == 404
    assert missing.json()["code"] == "LOAD_EVENT_NOT_FOUND"


async def test_rejects_invalid_load_events(client, auth_headers):
    invalid = [
        make_payload(kind="match"),
        make_payload(weekday=7),
        make_payload(weekday=-1),
        make_payload(duration_minutes=10),
        make_payload(duration_minutes=301),
        make_payload(name="   "),
        make_payload(season_start="2027-01-01", season_end="2026-12-31"),
        make_payload(season_start="2026-01-01", season_end="2027-01-03"),
    ]
    for payload in invalid:
        response = await client.post(BASE, json=payload, headers=auth_headers)
        assert response.status_code == 422, payload


async def test_calendar_lists_load_event_occurrences_in_range(client, auth_headers):
    # Saturdays from 1 Sep 2026; the season ends on Saturday 17 Oct 2026.
    game = await client.post(
        BASE,
        json=make_payload(season_end="2026-10-17"),
        headers=auth_headers,
    )
    # Tuesday practice, season starting mid-October.
    practice = await client.post(
        BASE,
        json=make_payload(
            name="Practice",
            kind="practice",
            weekday=1,
            start_time="20:15",
            season_start="2026-10-13",
        ),
        headers=auth_headers,
    )
    response = await client.get(f"{CALENDAR}?from=2026-10-01&to=2026-10-31", headers=auth_headers)
    assert response.status_code == 200
    occurrences = response.json()["load_events"]
    assert [(item["date"], item["kind"]) for item in occurrences] == [
        ("2026-10-03", "game"),
        ("2026-10-10", "game"),
        ("2026-10-13", "practice"),
        ("2026-10-17", "game"),
        ("2026-10-20", "practice"),
        ("2026-10-27", "practice"),
    ]
    first = occurrences[0]
    assert first["event_id"] == game.json()["id"]
    assert first["name"] == "League game"
    assert first["start_time"] == "19:30:00"
    assert first["duration_minutes"] == 75
    assert occurrences[2]["event_id"] == practice.json()["id"]


async def test_calendar_orders_same_day_occurrences_by_time(client, auth_headers):
    await client.post(BASE, json=make_payload(start_time="18:00"), headers=auth_headers)
    await client.post(
        BASE, json=make_payload(name="Early skate", start_time="07:00"), headers=auth_headers
    )
    response = await client.get(f"{CALENDAR}?from=2026-10-03&to=2026-10-03", headers=auth_headers)
    names = [item["name"] for item in response.json()["load_events"]]
    assert names == ["Early skate", "League game"]


async def test_calendar_without_load_events_returns_an_empty_list(client, auth_headers):
    response = await client.get(f"{CALENDAR}?from=2026-10-01&to=2026-10-31", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["load_events"] == []
