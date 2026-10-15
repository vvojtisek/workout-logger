TEMPLATES = "/api/v1/program-templates"
CALENDAR = "/api/v1/calendar"


async def calendar(client, auth_headers, date_from: str, date_to: str) -> list[dict]:
    response = await client.get(
        CALENDAR, params={"from": date_from, "to": date_to}, headers=auth_headers
    )
    assert response.status_code == 200
    return response.json()["items"]


async def test_lists_the_bundled_templates(client, auth_headers):
    response = await client.get(TEMPLATES, headers=auth_headers)

    assert response.status_code == 200
    by_key = {item["key"]: item for item in response.json()["items"]}
    assert set(by_key) == {"local-gym-ab", "office-gym-12-week"}
    assert by_key["local-gym-ab"]["location"] == "Local gym"
    assert by_key["local-gym-ab"]["schedule_type"] == "sequence"
    assert by_key["local-gym-ab"]["session_count"] == 12
    assert by_key["local-gym-ab"]["default_weekdays"] == [0, 2]
    assert by_key["office-gym-12-week"]["schedule_type"] == "weekly"
    assert by_key["office-gym-12-week"]["session_count"] == 36
    assert len(by_key["office-gym-12-week"]["plan_names"]) == 9


async def test_install_gym_alternates_a_and_b_on_chosen_weekdays(client, auth_headers):
    response = await client.post(
        f"{TEMPLATES}/local-gym-ab/install",
        json={"start_date": "2026-10-20", "weekdays": [1, 4]},
        headers=auth_headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["program"]["name"] == "Local gym A/B: hockey strength and shoulder tolerance"
    assert body["program"]["start_date"] == "2026-10-20"
    assert body["program"]["end_date"] == "2026-11-27"
    assert body["scheduled_count"] == 12
    assert len(body["plan_ids"]) == 2

    items = await calendar(client, auth_headers, "2026-10-01", "2026-12-31")
    assert [item["scheduled_date"] for item in items[:4]] == [
        "2026-10-20",
        "2026-10-23",
        "2026-10-27",
        "2026-10-30",
    ]
    assert [item["workout_plan_name"][:11] for item in items[:3]] == [
        "Local gym A",
        "Local gym B",
        "Local gym A",
    ]
    assert items[0]["notes"].startswith("Session 1 of 12: Establish comfortable ranges")
    assert items[0]["program_name"] == body["program"]["name"]

    plan = await client.get(f"/api/v1/plans/{body['plan_ids'][0]}", headers=auth_headers)
    exercises = plan.json()["exercises"]
    assert exercises[0]["exercise_name"] == "Leg press"
    assert exercises[0]["target_sets"] == 3


async def test_install_office_snaps_to_monday_and_carries_weekly_notes(client, auth_headers):
    response = await client.post(
        f"{TEMPLATES}/office-gym-12-week/install",
        json={"start_date": "2026-10-21"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["program"]["start_date"] == "2026-10-26"
    assert body["program"]["end_date"] == "2027-01-13"
    assert body["scheduled_count"] == 36
    assert len(body["plan_ids"]) == 9

    week_one = await calendar(client, auth_headers, "2026-10-26", "2026-11-01")
    assert [item["workout_plan_name"] for item in week_one] == [
        "Office M1 Day A: lower body and core",
        "Office M1 Day B: upper body push and pull",
        "Office M1 Day C: upper hypertrophy, arms and prehab",
    ]
    assert week_one[0]["notes"].startswith("Week 1 of 12, RPE 7.")

    week_four = await calendar(client, auth_headers, "2026-11-16", "2026-11-22")
    assert "Deload" in week_four[0]["notes"]
    week_five = await calendar(client, auth_headers, "2026-11-23", "2026-11-29")
    assert week_five[0]["workout_plan_name"].startswith("Office M2 Day A")

    plans = await client.get("/api/v1/plans?limit=100", headers=auth_headers)
    month_one_a = next(p for p in plans.json()["items"] if p["name"].startswith("Office M1 Day A"))
    rdl = month_one_a["exercises"][0]
    assert (rdl["exercise_name"], rdl["target_weight_kg"], rdl["target_sets"]) == (
        "Barbell Romanian deadlift",
        65.0,
        4,
    )
    assert (rdl["target_reps_min"], rdl["target_reps_max"], rdl["rest_time_seconds"]) == (
        8,
        10,
        120,
    )


async def test_installing_twice_is_a_conflict(client, auth_headers):
    first = await client.post(
        f"{TEMPLATES}/local-gym-ab/install", json={"start_date": "2026-10-20"}, headers=auth_headers
    )
    second = await client.post(
        f"{TEMPLATES}/local-gym-ab/install", json={"start_date": "2026-10-20"}, headers=auth_headers
    )

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["code"] == "PROGRAM_TEMPLATE_ALREADY_INSTALLED"


async def test_removing_a_program_frees_it_to_start_again_and_keeps_history(client, auth_headers):
    first = await client.post(
        f"{TEMPLATES}/local-gym-ab/install", json={"start_date": "2026-10-19"}, headers=auth_headers
    )
    assert first.status_code == 201
    program_id = first.json()["program"]["id"]
    old_plan_ids = first.json()["plan_ids"]

    # Train the first session so there is history to keep.
    items = await calendar(client, auth_headers, "2026-10-19", "2026-10-19")
    started = await client.post(
        f"/api/v1/scheduled-workouts/{items[0]['id']}/start", headers=auth_headers
    )
    assert started.status_code == 201
    session_id = started.json()["id"]
    await client.post(
        f"/api/v1/workout-sessions/{session_id}/sets",
        json={
            "session_exercise_id": started.json()["exercises"][0]["id"],
            "set_number": 1,
            "weight_kg": 80,
            "reps": 10,
            "rir": 2,
            "state": "completed",
            "client_operation_id": "op-remove-program",
        },
        headers=auth_headers,
    )
    completed = await client.post(
        f"/api/v1/workout-sessions/{session_id}/complete",
        json={"overall_feeling": 4},
        headers=auth_headers,
    )
    assert completed.status_code == 200
    logs_before = (await client.get("/api/v1/logs", headers=auth_headers)).json()

    removed = await client.delete(f"/api/v1/programs/{program_id}", headers=auth_headers)
    assert removed.status_code == 204

    # The program's plans and planned sessions are gone; the trained session is not.
    for plan_id in old_plan_ids:
        gone = await client.get(f"/api/v1/plans/{plan_id}", headers=auth_headers)
        assert gone.status_code == 404
    plans = (await client.get("/api/v1/plans", headers=auth_headers)).json()["items"]
    assert not [plan for plan in plans if plan["name"].startswith("Local gym ")]
    assert await calendar(client, auth_headers, "2026-10-01", "2026-12-31") == []
    logs_after = (await client.get("/api/v1/logs", headers=auth_headers)).json()
    # Only the link to the deleted plan is cleared.
    for log in logs_before["items"]:
        log["source_plan_id"] = None
    assert logs_after == logs_before
    assert logs_after["items"][0]["source_plan_name"].startswith("Local gym A")

    # It can be started again on a different day.
    again = await client.post(
        f"{TEMPLATES}/local-gym-ab/install",
        json={"start_date": "2026-11-03", "weekdays": [1, 4]},
        headers=auth_headers,
    )
    assert again.status_code == 201
    assert again.json()["program"]["start_date"] == "2026-11-03"
    items = await calendar(client, auth_headers, "2026-10-01", "2026-12-31")
    assert len(items) == 12
    assert items[0]["scheduled_date"] == "2026-11-03"


async def test_removing_a_hand_made_program_keeps_its_plans(client, auth_headers):
    plan = await client.post(
        "/api/v1/plans",
        json={
            "name": "My own plan",
            "exercises": [
                {
                    "exercise_name": "Row",
                    "target_sets": 1,
                    "target_reps_min": 5,
                    "target_reps_max": 8,
                    "rest_time_seconds": 60,
                }
            ],
        },
        headers=auth_headers,
    )
    program = await client.post(
        "/api/v1/programs",
        json={"name": "Mine", "kind": "Strength", "start_date": "2026-10-20"},
        headers=auth_headers,
    )
    await client.post(
        "/api/v1/scheduled-workouts",
        json={
            "workout_plan_id": plan.json()["id"],
            "program_id": program.json()["id"],
            "scheduled_date": "2026-10-21",
        },
        headers=auth_headers,
    )

    removed = await client.delete(f"/api/v1/programs/{program.json()['id']}", headers=auth_headers)

    assert removed.status_code == 204
    kept = await client.get(f"/api/v1/plans/{plan.json()['id']}", headers=auth_headers)
    assert kept.status_code == 200


async def test_install_validates_template_and_weekdays(client, auth_headers):
    unknown = await client.post(
        f"{TEMPLATES}/nope/install", json={"start_date": "2026-10-20"}, headers=auth_headers
    )
    too_many = await client.post(
        f"{TEMPLATES}/local-gym-ab/install",
        json={"start_date": "2026-10-20", "weekdays": [0, 2, 4]},
        headers=auth_headers,
    )
    bad_day = await client.post(
        f"{TEMPLATES}/local-gym-ab/install",
        json={"start_date": "2026-10-20", "weekdays": [7]},
        headers=auth_headers,
    )

    assert unknown.status_code == 404
    assert too_many.status_code == 422
    assert bad_day.status_code == 422


async def test_scheduled_workout_accepts_and_returns_notes(client, auth_headers):
    plan = await client.post(
        "/api/v1/plans", json={"name": "Noted plan", "exercises": []}, headers=auth_headers
    )
    created = await client.post(
        "/api/v1/scheduled-workouts",
        json={
            "workout_plan_id": plan.json()["id"],
            "scheduled_date": "2026-10-20",
            "notes": "Easy week",
        },
        headers=auth_headers,
    )

    assert created.status_code == 201
    assert created.json()["notes"] == "Easy week"
