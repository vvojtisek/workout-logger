from datetime import datetime
from uuid import UUID

SESSIONS = "/api/v1/workout-sessions"
PLANS = "/api/v1/plans"
LOGS = "/api/v1/logs"


def plan_payload(name: str = "Slice 1 Plan") -> dict:
    return {
        "name": name,
        "description": "walking skeleton",
        "exercises": [
            {
                "exercise_name": "Bench Press",
                "target_sets": 3,
                "target_reps_min": 8,
                "target_reps_max": 10,
                "target_weight_kg": 42.5,
                "rest_time_seconds": 90,
                "notes": "controlled reps",
            }
        ],
    }


async def create_plan(client, auth_headers, name: str = "Slice 1 Plan") -> dict:
    response = await client.post(PLANS, json=plan_payload(name), headers=auth_headers)
    assert response.status_code == 201
    return response.json()


async def start_session(client, auth_headers, plan_id: str) -> dict:
    response = await client.post(
        SESSIONS,
        json={"source_plan_id": plan_id},
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.json()


async def test_start_session_snapshots_plan_and_prefers_latest_history(client, auth_headers):
    plan = await create_plan(client, auth_headers)
    history = await client.post(
        LOGS,
        json={
            "source_plan_id": plan["id"],
            "performed_at": "2026-08-20T10:00:00Z",
            "total_time_minutes": 30,
            "overall_feeling": 4,
            "exercises": [
                {
                    "exercise_name": "Bench Press",
                    "sets_count": 1,
                    "reps_per_set": [7],
                    "weight_kg": 47.5,
                    "rest_time_seconds": 90,
                }
            ],
        },
        headers=auth_headers,
    )
    assert history.status_code == 201

    session = await start_session(client, auth_headers, plan["id"])

    assert session["source_plan_id"] == plan["id"]
    assert session["source_plan_name"] == plan["name"]
    assert session["status"] == "active"
    assert session["focused_set_number"] == 1
    assert session["rest_ends_at"] is None
    assert len(session["exercises"]) == 1
    exercise = session["exercises"][0]
    assert exercise["exercise_name"] == "Bench Press"
    assert exercise["target_sets"] == 3
    assert exercise["suggested_weight_kg"] == 47.5
    assert exercise["suggested_reps"] == 7
    assert exercise["suggestion_source"] == "history"
    assert exercise["set_entries"] == []
    assert session["focused_exercise_id"] == exercise["id"]


async def test_duplicate_start_returns_the_existing_active_session(client, auth_headers):
    plan = await create_plan(client, auth_headers)
    first = await start_session(client, auth_headers, plan["id"])

    duplicate = await client.post(
        SESSIONS,
        json={"source_plan_id": plan["id"]},
        headers=auth_headers,
    )

    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == first["id"]

    active = await client.get(f"{SESSIONS}/active", headers=auth_headers)
    assert active.status_code == 200
    assert active.json()["id"] == first["id"]


async def test_set_completion_is_idempotent_and_survives_read(client, auth_headers):
    plan = await create_plan(client, auth_headers)
    session = await start_session(client, auth_headers, plan["id"])
    exercise_id = session["exercises"][0]["id"]
    operation_id = "test-run-idempotent-set-1"
    payload = {
        "session_exercise_id": exercise_id,
        "set_number": 1,
        "weight_kg": 42.5,
        "reps": 8,
        "rir": 2,
        "client_operation_id": operation_id,
    }

    saved = await client.post(
        f"{SESSIONS}/{session['id']}/sets", json=payload, headers=auth_headers
    )
    assert saved.status_code == 201
    saved_body = saved.json()
    first_entry = saved_body["exercises"][0]["set_entries"][0]
    assert first_entry["state"] == "completed"
    assert first_entry["weight_kg"] == 42.5
    assert first_entry["reps"] == 8
    assert first_entry["rir"] == 2
    assert first_entry["client_operation_id"] == operation_id
    assert datetime.fromisoformat(saved_body["rest_ends_at"]) > datetime.fromisoformat(
        saved_body["started_at"]
    )

    duplicate = await client.post(
        f"{SESSIONS}/{session['id']}/sets", json=payload, headers=auth_headers
    )
    assert duplicate.status_code == 200
    duplicate_entries = duplicate.json()["exercises"][0]["set_entries"]
    assert len(duplicate_entries) == 1
    assert duplicate_entries[0]["id"] == first_entry["id"]

    reloaded = await client.get(f"{SESSIONS}/{session['id']}", headers=auth_headers)
    assert reloaded.status_code == 200
    assert reloaded.json()["rest_ends_at"] == saved_body["rest_ends_at"]
    assert reloaded.json()["exercises"][0]["set_entries"] == duplicate_entries


async def test_complete_session_creates_existing_history_summary(client, auth_headers):
    plan = await create_plan(client, auth_headers)
    session = await start_session(client, auth_headers, plan["id"])
    exercise_id = session["exercises"][0]["id"]
    await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": exercise_id,
            "set_number": 1,
            "weight_kg": 42.5,
            "reps": 8,
            "rir": 2,
            "client_operation_id": "test-run-complete-set-1",
        },
        headers=auth_headers,
    )

    completed = await client.post(
        f"{SESSIONS}/{session['id']}/complete",
        json={"overall_feeling": 4},
        headers=auth_headers,
    )

    assert completed.status_code == 200
    completed_body = completed.json()
    assert completed_body["status"] == "completed"
    assert completed_body["completed_at"] is not None
    assert completed_body["workout_log_id"] is not None

    history = await client.get(
        f"{LOGS}/{completed_body['workout_log_id']}", headers=auth_headers
    )
    assert history.status_code == 200
    history_body = history.json()
    assert history_body["source_plan_id"] == plan["id"]
    assert history_body["source_plan_name"] == plan["name"]
    assert history_body["overall_feeling"] == 4
    assert history_body["total_time_minutes"] >= 1
    assert history_body["exercises"][0]["exercise_name"] == "Bench Press"
    assert history_body["exercises"][0]["reps_per_set"] == [8]
    assert history_body["exercises"][0]["weight_kg"] == 42.5


async def test_delete_session_removes_it_for_test_data_cleanup(client, auth_headers):
    plan = await create_plan(client, auth_headers)
    session = await start_session(client, auth_headers, plan["id"])
    session_id = UUID(session["id"])

    deleted = await client.delete(f"{SESSIONS}/{session_id}", headers=auth_headers)
    assert deleted.status_code == 204

    missing = await client.get(f"{SESSIONS}/{session_id}", headers=auth_headers)
    assert missing.status_code == 404
