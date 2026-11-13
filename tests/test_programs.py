import uuid

BASE = "/api/v1/programs"


def make_program_payload(**overrides) -> dict:
    payload = {
        "name": "Hypertrophy Block",
        "kind": "Hypertrophy",
        "start_date": "2026-01-01",
        "end_date": "2026-03-01",
        "status": "active",
        "notes": "Focus on volume",
    }
    payload.update(overrides)
    return payload


async def test_create_program_with_full_fields(client, auth_headers):
    response = await client.post(BASE, json=make_program_payload(), headers=auth_headers)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Hypertrophy Block"
    assert body["kind"] == "Hypertrophy"
    assert body["status"] == "active"
    assert "Location" in response.headers
    assert response.headers["Location"] == f"{BASE}/{body['id']}"


async def test_create_program_without_end_date(client, auth_headers):
    payload = make_program_payload(end_date=None)
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["end_date"] is None


async def test_create_program_with_end_before_start_returns_422(client, auth_headers):
    payload = make_program_payload(start_date="2026-03-01", end_date="2026-01-01")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_program_with_blank_name_returns_422(client, auth_headers):
    payload = make_program_payload(name="   ")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_create_program_with_invalid_status_returns_422(client, auth_headers):
    payload = make_program_payload(status="paused")
    response = await client.post(BASE, json=payload, headers=auth_headers)
    assert response.status_code == 422


async def test_overlapping_programs_are_allowed(client, auth_headers):
    first = make_program_payload(name="Hockey Pre-Season", kind="Sport-specific")
    second = make_program_payload(name="Hypertrophy Block 2", kind="Hypertrophy")
    response1 = await client.post(BASE, json=first, headers=auth_headers)
    response2 = await client.post(BASE, json=second, headers=auth_headers)
    assert response1.status_code == 201
    assert response2.status_code == 201


async def test_get_program_detail(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_program_payload(name="Detail Program"), headers=auth_headers
    )
    program_id = create_resp.json()["id"]

    response = await client.get(f"{BASE}/{program_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == program_id


async def test_get_nonexistent_program_returns_404(client, auth_headers):
    response = await client.get(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["code"] == "PROGRAM_NOT_FOUND"


async def test_list_programs_pagination(client, auth_headers):
    for name, start in [
        ("Program A", "2026-01-01"),
        ("Program B", "2026-02-01"),
        ("Program C", "2026-03-01"),
    ]:
        await client.post(
            BASE, json=make_program_payload(name=name, start_date=start), headers=auth_headers
        )

    response = await client.get(f"{BASE}?limit=2&offset=0", headers=auth_headers)
    body = response.json()
    assert body["limit"] == 2
    assert body["offset"] == 0
    assert body["total"] == 3
    assert len(body["items"]) == 2


async def test_program_schedule_summary_counts_each_calendar_state(client, auth_headers):
    plan_response = await client.post(
        "/api/v1/plans",
        json={
            "name": "Schedule summary plan",
            "exercises": [
                {
                    "exercise_name": "Bench press",
                    "target_sets": 1,
                    "target_reps_min": 5,
                    "target_reps_max": 8,
                    "target_weight_kg": 60,
                }
            ],
        },
        headers=auth_headers,
    )
    assert plan_response.status_code == 201
    plan_id = plan_response.json()["id"]
    program_response = await client.post(BASE, json=make_program_payload(), headers=auth_headers)
    assert program_response.status_code == 201
    program_id = program_response.json()["id"]

    scheduled_ids = []
    for scheduled_date in ("2026-01-02", "2026-01-05", "2026-01-09", "2026-01-12"):
        response = await client.post(
            "/api/v1/scheduled-workouts",
            json={
                "program_id": program_id,
                "workout_plan_id": plan_id,
                "scheduled_date": scheduled_date,
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        scheduled_ids.append(response.json()["id"])
    for scheduled_date in ("2025-12-31", "2026-03-02"):
        response = await client.post(
            "/api/v1/scheduled-workouts",
            json={
                "program_id": program_id,
                "workout_plan_id": plan_id,
                "scheduled_date": scheduled_date,
            },
            headers=auth_headers,
        )
        assert response.status_code == 201

    skipped = await client.patch(
        f"/api/v1/scheduled-workouts/{scheduled_ids[1]}",
        json={"status": "skipped"},
        headers=auth_headers,
    )
    assert skipped.status_code == 200
    completed_session = await client.post(
        f"/api/v1/scheduled-workouts/{scheduled_ids[2]}/start", headers=auth_headers
    )
    assert completed_session.status_code == 201
    session = completed_session.json()
    saved = await client.post(
        f"/api/v1/workout-sessions/{session['id']}/sets",
        json={
            "session_exercise_id": session["exercises"][0]["id"],
            "set_number": 1,
            "weight_kg": 60,
            "reps": 8,
            "client_operation_id": "program-summary-completed",
        },
        headers=auth_headers,
    )
    assert saved.status_code == 201
    completed = await client.post(
        f"/api/v1/workout-sessions/{session['id']}/complete",
        json={"overall_feeling": 4},
        headers=auth_headers,
    )
    assert completed.status_code == 200

    in_progress = await client.post(
        f"/api/v1/scheduled-workouts/{scheduled_ids[3]}/start", headers=auth_headers
    )
    assert in_progress.status_code == 201

    response = await client.get(f"{BASE}/schedule-summary", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "items": [
            {
                "program_id": program_id,
                "scheduled": 3,
                "in_progress": 1,
                "completed": 1,
                "skipped": 1,
                "weeks": [
                    {
                        "week_number": 1,
                        "scheduled": 1,
                        "in_progress": 0,
                        "completed": 0,
                        "skipped": 1,
                    },
                    {
                        "week_number": 2,
                        "scheduled": 0,
                        "in_progress": 1,
                        "completed": 1,
                        "skipped": 0,
                    },
                ],
            }
        ]
    }


async def test_replace_program_updates_fields(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_program_payload(name="Old Name"), headers=auth_headers
    )
    program_id = create_resp.json()["id"]

    replace_payload = make_program_payload(name="New Name", status="completed")
    response = await client.put(f"{BASE}/{program_id}", json=replace_payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New Name"
    assert body["status"] == "completed"


async def test_replace_nonexistent_program_returns_404(client, auth_headers):
    response = await client.put(
        f"{BASE}/{uuid.uuid4()}", json=make_program_payload(), headers=auth_headers
    )
    assert response.status_code == 404


async def test_delete_program(client, auth_headers):
    create_resp = await client.post(
        BASE, json=make_program_payload(name="To Delete"), headers=auth_headers
    )
    program_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"{BASE}/{program_id}", headers=auth_headers)
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"{BASE}/{program_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_nonexistent_program_returns_404(client, auth_headers):
    response = await client.delete(f"{BASE}/{uuid.uuid4()}", headers=auth_headers)
    assert response.status_code == 404


async def test_delete_program_cascades_to_scheduled_workouts(client, auth_headers):
    plan_resp = await client.post(
        "/api/v1/plans",
        json={
            "name": "Cascade Plan",
            "exercises": [
                {
                    "exercise_name": "Squat",
                    "target_sets": 3,
                    "target_reps_min": 5,
                    "target_reps_max": 8,
                    "rest_time_seconds": 90,
                }
            ],
        },
        headers=auth_headers,
    )
    plan_id = plan_resp.json()["id"]

    program_resp = await client.post(
        BASE, json=make_program_payload(name="Cascade Program"), headers=auth_headers
    )
    program_id = program_resp.json()["id"]

    scheduled_resp = await client.post(
        "/api/v1/scheduled-workouts",
        json={"program_id": program_id, "workout_plan_id": plan_id, "scheduled_date": "2026-01-05"},
        headers=auth_headers,
    )
    scheduled_id = scheduled_resp.json()["id"]

    await client.delete(f"{BASE}/{program_id}", headers=auth_headers)

    get_resp = await client.get(f"/api/v1/scheduled-workouts/{scheduled_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_invalid_uuid_path_param_returns_422(client, auth_headers):
    response = await client.get(f"{BASE}/not-a-uuid", headers=auth_headers)
    assert response.status_code == 422
