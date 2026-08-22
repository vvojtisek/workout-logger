import uuid

SCHEDULED = "/api/v1/scheduled-workouts"
PROGRAMS = "/api/v1/programs"
PLANS = "/api/v1/plans"
SESSIONS = "/api/v1/workout-sessions"
CALENDAR = "/api/v1/calendar"


async def create_plan(
    client, auth_headers, name: str = "Squat Day", with_exercise: bool = True
) -> str:
    exercises = (
        [
            {
                "exercise_name": "Squat",
                "target_sets": 3,
                "target_reps_min": 5,
                "target_reps_max": 8,
                "rest_time_seconds": 90,
            }
        ]
        if with_exercise
        else []
    )
    response = await client.post(
        PLANS, json={"name": name, "exercises": exercises}, headers=auth_headers
    )
    assert response.status_code == 201
    return response.json()["id"]


async def create_program(client, auth_headers, name: str = "Block") -> str:
    response = await client.post(
        PROGRAMS,
        json={"name": name, "kind": "Hypertrophy", "start_date": "2026-01-01"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_schedule_workout_without_program(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    response = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["program_id"] is None
    assert body["status"] == "scheduled"
    assert body["workout_plan_name"] == "Squat Day"
    assert "Location" in response.headers


async def test_schedule_workout_with_program(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    program_id = await create_program(client, auth_headers)
    response = await client.post(
        SCHEDULED,
        json={"program_id": program_id, "workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["program_id"] == program_id
    assert body["program_name"] == "Block"


async def test_schedule_workout_with_nonexistent_program_returns_404(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    response = await client.post(
        SCHEDULED,
        json={
            "program_id": str(uuid.uuid4()),
            "workout_plan_id": plan_id,
            "scheduled_date": "2026-01-05",
        },
        headers=auth_headers,
    )
    assert response.status_code == 404
    assert response.json()["code"] == "PROGRAM_NOT_FOUND"


async def test_schedule_workout_with_nonexistent_plan_returns_404(client, auth_headers):
    response = await client.post(
        SCHEDULED,
        json={"workout_plan_id": str(uuid.uuid4()), "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    assert response.status_code == 404
    assert response.json()["code"] == "PLAN_NOT_FOUND"


async def test_multiple_workouts_same_day_are_allowed(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    response1 = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    response2 = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    assert response1.status_code == 201
    assert response2.status_code == 201


async def test_get_nonexistent_scheduled_workout_returns_404(client, auth_headers):
    response = await client.get(f"{SCHEDULED}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "SCHEDULED_WORKOUT_NOT_FOUND"


async def test_reschedule_date(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]

    response = await client.patch(
        f"{SCHEDULED}/{scheduled_id}", json={"scheduled_date": "2026-01-10"}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["scheduled_date"] == "2026-01-10"


async def test_move_to_program_and_clear_program(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    program_id = await create_program(client, auth_headers)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]

    response = await client.patch(
        f"{SCHEDULED}/{scheduled_id}", json={"program_id": program_id}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["program_id"] == program_id

    response = await client.patch(
        f"{SCHEDULED}/{scheduled_id}", json={"program_id": None}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["program_id"] is None


async def test_skip_and_unskip(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]

    response = await client.patch(
        f"{SCHEDULED}/{scheduled_id}", json={"status": "skipped"}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["status"] == "skipped"

    response = await client.patch(
        f"{SCHEDULED}/{scheduled_id}", json={"status": "scheduled"}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["status"] == "scheduled"


async def test_delete_scheduled_workout(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{SCHEDULED}/{scheduled_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{SCHEDULED}/{scheduled_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_nonexistent_scheduled_workout_returns_404(client, auth_headers):
    response = await client.delete(f"{SCHEDULED}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404


async def test_start_scheduled_workout_creates_real_session_and_links_it(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]

    response = await client.post(f"{SCHEDULED}/{scheduled_id}/start", headers=auth_headers)
    assert response.status_code == 201
    session_id = response.json()["id"]
    assert response.json()["status"] == "active"

    scheduled_after = await client.get(f"{SCHEDULED}/{scheduled_id}", headers=auth_headers)
    assert scheduled_after.json()["status"] == "in_progress"
    assert scheduled_after.json()["workout_session_id"] == session_id


async def test_start_scheduled_workout_with_no_exercises_returns_409(client, auth_headers):
    plan_id = await create_plan(client, auth_headers, name="Empty Plan", with_exercise=False)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]

    response = await client.post(f"{SCHEDULED}/{scheduled_id}/start", headers=auth_headers)
    assert response.status_code == 409
    assert response.json()["code"] == "PLAN_HAS_NO_EXERCISES"


async def test_start_scheduled_workout_twice_returns_409(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]

    first = await client.post(f"{SCHEDULED}/{scheduled_id}/start", headers=auth_headers)
    assert first.status_code == 201

    second = await client.post(f"{SCHEDULED}/{scheduled_id}/start", headers=auth_headers)
    assert second.status_code == 409
    assert second.json()["code"] == "SCHEDULED_WORKOUT_NOT_SCHEDULED"


async def test_cannot_skip_an_in_progress_scheduled_workout(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]
    await client.post(f"{SCHEDULED}/{scheduled_id}/start", headers=auth_headers)

    response = await client.patch(
        f"{SCHEDULED}/{scheduled_id}", json={"status": "skipped"}, headers=auth_headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "SCHEDULED_WORKOUT_NOT_EDITABLE"


async def test_cancelling_the_linked_session_reverts_scheduled_workout(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]
    start_resp = await client.post(f"{SCHEDULED}/{scheduled_id}/start", headers=auth_headers)
    session_id = start_resp.json()["id"]

    delete_resp = await client.delete(f"{SESSIONS}/{session_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    scheduled_after = await client.get(f"{SCHEDULED}/{scheduled_id}", headers=auth_headers)
    assert scheduled_after.json()["status"] == "scheduled"
    assert scheduled_after.json()["workout_session_id"] is None

    # And it can be started again.
    restart = await client.post(f"{SCHEDULED}/{scheduled_id}/start", headers=auth_headers)
    assert restart.status_code == 201


async def test_completing_the_linked_session_completes_scheduled_workout(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    create_resp = await client.post(
        SCHEDULED,
        json={"workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = create_resp.json()["id"]
    start_resp = await client.post(f"{SCHEDULED}/{scheduled_id}/start", headers=auth_headers)
    session_id = start_resp.json()["id"]
    exercise_id = start_resp.json()["exercises"][0]["id"]

    await client.post(
        f"{SESSIONS}/{session_id}/sets",
        json={
            "session_exercise_id": exercise_id,
            "set_number": 1,
            "weight_kg": 60,
            "reps": 5,
            "rir": 2,
            "state": "completed",
            "client_operation_id": "op-complete-sync",
        },
        headers=auth_headers,
    )
    complete_resp = await client.post(
        f"{SESSIONS}/{session_id}/complete", json={"overall_feeling": 4}, headers=auth_headers
    )
    assert complete_resp.status_code == 200

    scheduled_after = await client.get(f"{SCHEDULED}/{scheduled_id}", headers=auth_headers)
    assert scheduled_after.json()["status"] == "completed"
    assert scheduled_after.json()["workout_session_id"] == session_id


async def test_calendar_returns_only_workouts_in_range(client, auth_headers):
    plan_id = await create_plan(client, auth_headers)
    for scheduled_date in ["2026-01-04", "2026-01-15", "2026-02-01"]:
        await client.post(
            SCHEDULED,
            json={"workout_plan_id": plan_id, "scheduled_date": scheduled_date},
            headers=auth_headers,
        )

    response = await client.get(f"{CALENDAR}?from=2026-01-01&to=2026-01-31", headers=auth_headers)
    assert response.status_code == 200
    dates = [item["scheduled_date"] for item in response.json()["items"]]
    assert dates == ["2026-01-04", "2026-01-15"]


async def test_calendar_requires_to_after_from(client, auth_headers):
    response = await client.get(f"{CALENDAR}?from=2026-01-31&to=2026-01-01", headers=auth_headers)
    assert response.status_code == 422


async def test_calendar_rejects_a_span_over_366_days(client, auth_headers):
    response = await client.get(f"{CALENDAR}?from=2026-01-01&to=2028-01-01", headers=auth_headers)
    assert response.status_code == 422


async def test_invalid_uuid_path_param_returns_422(client, auth_headers):
    response = await client.get(f"{SCHEDULED}/not-a-uuid", headers=auth_headers)
    assert response.status_code == 422
