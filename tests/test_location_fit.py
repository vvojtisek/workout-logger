"""Training at a location: starting a workout there, flagging exercises the
place can't host with swap suggestions, and filtering the catalogue."""

SESSIONS = "/api/v1/workout-sessions"
PLANS = "/api/v1/plans"
EXERCISES = "/api/v1/exercises"
LOCATIONS = "/api/v1/locations"


async def add_exercise(client, headers, name, equipment, primary, secondary=(), aliases=()):
    response = await client.post(
        EXERCISES,
        json={
            "name": name,
            "aliases": list(aliases),
            "primary_muscles": list(primary),
            "secondary_muscles": list(secondary),
            "equipment": equipment,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def add_location(client, headers, equipment, name="Office"):
    response = await client.post(
        LOCATIONS, json={"name": name, "kind": "office", "equipment": equipment}, headers=headers
    )
    assert response.status_code == 201
    return response.json()


async def add_plan(client, headers, names):
    response = await client.post(
        PLANS,
        json={
            "name": "Location plan",
            "exercises": [
                {
                    "exercise_name": name,
                    "target_sets": 3,
                    "target_reps_min": 8,
                    "target_reps_max": 10,
                }
                for name in names
            ],
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


async def seed_catalogue(client, headers):
    await add_exercise(
        client,
        headers,
        "Test Back Squat",
        "barbell, squat rack",
        ["quads", "glutes"],
        ["hamstrings"],
        aliases=["Test Barbell Squat"],
    )
    await add_exercise(
        client, headers, "Test Goblet Squat", "dumbbell or kettlebell", ["quads", "glutes"]
    )
    await add_exercise(client, headers, "Test Split Squat", "bodyweight", ["quads"], ["glutes"])
    await add_exercise(client, headers, "Test Leg Press", "leg press machine", ["quads", "glutes"])
    await add_exercise(client, headers, "Test Push-up", "bodyweight", ["chest", "triceps"])


async def test_start_at_a_location_records_it(client, auth_headers):
    location = await add_location(client, auth_headers, ["dumbbell"])
    plan = await add_plan(client, auth_headers, ["Anything"])
    started = await client.post(
        SESSIONS,
        json={"source_plan_id": plan["id"], "location_id": location["id"]},
        headers=auth_headers,
    )
    assert started.status_code == 201
    assert started.json()["location_id"] == location["id"]


async def test_start_without_a_location_leaves_it_empty(client, auth_headers):
    plan = await add_plan(client, auth_headers, ["Anything"])
    started = await client.post(SESSIONS, json={"source_plan_id": plan["id"]}, headers=auth_headers)
    assert started.status_code == 201
    assert started.json()["location_id"] is None
    check = await client.get(
        f"{SESSIONS}/{started.json()['id']}/location-check", headers=auth_headers
    )
    assert check.status_code == 200
    assert check.json() == {"location": None, "items": []}


async def test_start_at_an_unknown_location_returns_404(client, auth_headers):
    plan = await add_plan(client, auth_headers, ["Anything"])
    started = await client.post(
        SESSIONS,
        json={"source_plan_id": plan["id"], "location_id": "00000000-0000-0000-0000-000000000000"},
        headers=auth_headers,
    )
    assert started.status_code == 404
    assert started.json()["code"] == "LOCATION_NOT_FOUND"


async def test_location_check_flags_what_the_place_cannot_host(client, auth_headers):
    await seed_catalogue(client, auth_headers)
    location = await add_location(client, auth_headers, ["dumbbell", "bench"])
    # Matched by alias; the push-up needs nothing; the last one is not in the catalogue.
    plan = await add_plan(
        client, auth_headers, ["Test Barbell Squat", "Test Push-up", "Not In Catalogue"]
    )
    started = await client.post(
        SESSIONS,
        json={"source_plan_id": plan["id"], "location_id": location["id"]},
        headers=auth_headers,
    )
    session = started.json()

    check = await client.get(f"{SESSIONS}/{session['id']}/location-check", headers=auth_headers)
    assert check.status_code == 200
    body = check.json()
    assert body["location"] == {"id": location["id"], "name": "Office"}
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["session_exercise_id"] == session["exercises"][0]["id"]
    assert item["exercise_name"] == "Test Barbell Squat"
    assert item["needs"] == [["barbell", "rack"]]
    # Same muscles first, only what the place can host, never the leg press.
    assert item["swaps"] == [
        {"exercise_name": "Test Goblet Squat", "exercise_kind": "strength"},
        {"exercise_name": "Test Split Squat", "exercise_kind": "bodyweight"},
    ]

    # Swapping clears the flag.
    swapped = await client.patch(
        f"{SESSIONS}/{session['id']}/exercises/{item['session_exercise_id']}",
        json=item["swaps"][0],
        headers=auth_headers,
    )
    assert swapped.status_code == 200
    again = await client.get(f"{SESSIONS}/{session['id']}/location-check", headers=auth_headers)
    assert again.json()["items"] == []


async def test_catalogue_filter_by_location(client, auth_headers):
    await seed_catalogue(client, auth_headers)
    location = await add_location(client, auth_headers, ["kettlebell"])
    response = await client.get(
        f"{EXERCISES}?q=Test&location_id={location['id']}", headers=auth_headers
    )
    assert response.status_code == 200
    names = [item["name"] for item in response.json()["items"]]
    assert names == ["Test Goblet Squat", "Test Push-up", "Test Split Squat"]
    assert response.json()["total"] == 3

    paged = await client.get(
        f"{EXERCISES}?q=Test&location_id={location['id']}&limit=1&offset=1", headers=auth_headers
    )
    assert [item["name"] for item in paged.json()["items"]] == ["Test Push-up"]
    assert paged.json()["total"] == 3


async def test_catalogue_filter_with_unknown_location_returns_404(client, auth_headers):
    response = await client.get(
        f"{EXERCISES}?location_id=00000000-0000-0000-0000-000000000000", headers=auth_headers
    )
    assert response.status_code == 404
