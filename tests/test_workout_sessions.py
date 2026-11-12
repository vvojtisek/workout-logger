from datetime import UTC, datetime, timedelta
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
    # Double progression: 7 reps is under the 8-10 range, so keep 47.5 kg
    # and aim for the bottom of the range.
    assert exercise["suggested_weight_kg"] == 47.5
    assert exercise["suggested_reps"] == 8
    assert exercise["suggestion_source"] == "history"
    assert exercise["set_entries"] == []
    assert session["focused_exercise_id"] == exercise["id"]


async def test_session_carries_its_location_plate_profiles(client, auth_headers):
    location = await client.post(
        "/api/v1/locations",
        json={
            "name": "Plate lab",
            "kind": "gym",
            "plate_profiles": [
                {
                    "name": "Safety squat bar",
                    "bar_kg": 25,
                    "collars_kg": 0.5,
                    "plates": [{"weight_kg": 5, "pairs": 2}],
                }
            ],
        },
        headers=auth_headers,
    )
    assert location.status_code == 201
    plan = await create_plan(client, auth_headers)
    started = await client.post(
        SESSIONS,
        json={"source_plan_id": plan["id"], "location_id": location.json()["id"]},
        headers=auth_headers,
    )
    assert started.status_code == 201
    expected = location.json()["plate_profiles"]
    assert started.json()["location"]["plate_profiles"] == expected

    active = await client.get(f"{SESSIONS}/active", headers=auth_headers)
    assert active.json()["location"]["plate_profiles"] == expected


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


async def test_complete_session_creates_existing_history_summary(migrated_client, auth_headers):
    client, _ = migrated_client
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
            "rpe": 0,
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

    history = await client.get(f"{LOGS}/{completed_body['workout_log_id']}", headers=auth_headers)
    assert history.status_code == 200
    history_body = history.json()
    assert history_body["source_plan_id"] == plan["id"]
    assert history_body["source_plan_name"] == plan["name"]
    assert history_body["overall_feeling"] == 4
    assert history_body["total_time_minutes"] >= 1
    assert history_body["exercises"][0]["exercise_name"] == "Bench Press"
    assert history_body["exercises"][0]["reps_per_set"] == [8]
    assert history_body["exercises"][0]["weight_kg"] == 42.5
    assert history_body["exercises"][0]["rir_per_set"] == [2]
    assert history_body["exercises"][0]["rpe_per_set"] == [0]
    assert history_body["effort_rpe"] is None


async def test_queued_set_replay_keeps_its_capture_time_and_rest(migrated_client, auth_headers):
    client, _ = migrated_client
    plan = await create_plan(client, auth_headers)
    session = await start_session(client, auth_headers, plan["id"])
    url = f"{SESSIONS}/{session['id']}/sets"
    payload = {
        "session_exercise_id": session["exercises"][0]["id"],
        "set_number": 1,
        "weight_kg": 42.5,
        "reps": 8,
        "client_operation_id": "test-run-offline-rest-1",
        "client_completed_at": session["started_at"],
    }

    replayed = await client.post(url, json=payload, headers=auth_headers)
    assert replayed.status_code == 201
    body = replayed.json()
    started_at = datetime.fromisoformat(session["started_at"])
    assert (
        datetime.fromisoformat(body["exercises"][0]["set_entries"][0]["completed_at"]) == started_at
    )
    assert datetime.fromisoformat(body["rest_ends_at"]) == started_at + timedelta(seconds=90)

    skipped_rest = await client.post(
        url,
        json={
            **payload,
            "set_number": 2,
            "client_operation_id": "test-run-offline-rest-2",
            "client_rest_seconds": 0,
        },
        headers=auth_headers,
    )
    assert skipped_rest.status_code == 201
    assert skipped_rest.json()["rest_ends_at"] is None

    sent_at = datetime.now(UTC)
    future = await client.post(
        url,
        json={
            **payload,
            "set_number": 3,
            "client_operation_id": "test-run-offline-rest-3",
            "client_completed_at": (sent_at + timedelta(hours=1)).isoformat(),
            "client_rest_seconds": 15,
        },
        headers=auth_headers,
    )
    assert future.status_code == 201
    body = future.json()
    completed_at = datetime.fromisoformat(body["exercises"][0]["set_entries"][2]["completed_at"])
    assert sent_at <= completed_at <= datetime.now(UTC)
    assert datetime.fromisoformat(body["rest_ends_at"]) == completed_at + timedelta(seconds=15)


async def test_older_queued_completion_preserves_newer_rest(migrated_client, auth_headers):
    client, _ = migrated_client
    plan = await create_plan(client, auth_headers)
    session = await start_session(client, auth_headers, plan["id"])
    url = f"{SESSIONS}/{session['id']}/sets"
    payload = {"session_exercise_id": session["exercises"][0]["id"], "reps": 8}
    latest = await client.post(
        url,
        json={**payload, "set_number": 2, "client_operation_id": "newer-rest-2"},
        headers=auth_headers,
    )
    assert latest.status_code == 201
    deadline = latest.json()["rest_ends_at"]

    earlier = await client.post(
        url,
        json={
            **payload,
            "set_number": 1,
            "client_operation_id": "earlier-rest-1",
            "client_completed_at": session["started_at"],
            "client_rest_seconds": 0,
        },
        headers=auth_headers,
    )
    assert earlier.status_code == 201
    assert earlier.json()["rest_ends_at"] == deadline


async def test_session_snapshots_exercise_kind_from_the_plan(client, auth_headers):
    payload = plan_payload("Kind Snapshot Plan")
    payload["exercises"][0]["exercise_kind"] = "bodyweight"
    response = await client.post(PLANS, json=payload, headers=auth_headers)
    assert response.status_code == 201
    plan = response.json()

    session = await start_session(client, auth_headers, plan["id"])
    assert session["exercises"][0]["exercise_kind"] == "bodyweight"


async def test_save_set_persists_bodyweight_kind_fields(client, auth_headers):
    payload = plan_payload("Bodyweight Set Plan")
    payload["exercises"][0]["exercise_kind"] = "bodyweight"
    plan = (await client.post(PLANS, json=payload, headers=auth_headers)).json()
    session = await start_session(client, auth_headers, plan["id"])
    exercise_id = session["exercises"][0]["id"]

    saved = await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": exercise_id,
            "set_number": 1,
            "reps": 12,
            "added_weight_kg": 5,
            "band_level": "medium",
            "client_operation_id": "test-run-bodyweight-set-1",
        },
        headers=auth_headers,
    )
    assert saved.status_code == 201
    entry = saved.json()["exercises"][0]["set_entries"][0]
    assert entry["added_weight_kg"] == 5
    assert entry["band_level"] == "medium"
    assert entry["duration_seconds"] is None


async def test_save_set_persists_cardio_kind_fields(client, auth_headers):
    payload = plan_payload("Cardio Set Plan")
    payload["exercises"][0]["exercise_kind"] = "cardio"
    plan = (await client.post(PLANS, json=payload, headers=auth_headers)).json()
    session = await start_session(client, auth_headers, plan["id"])
    exercise_id = session["exercises"][0]["id"]

    saved = await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": exercise_id,
            "set_number": 1,
            "reps": 1,
            "duration_seconds": 1800,
            "distance_km": 5.2,
            "incline_percent": 2.5,
            "client_operation_id": "test-run-cardio-set-1",
        },
        headers=auth_headers,
    )
    assert saved.status_code == 201
    entry = saved.json()["exercises"][0]["set_entries"][0]
    assert entry["duration_seconds"] == 1800
    assert entry["distance_km"] == 5.2
    assert entry["incline_percent"] == 2.5
    assert entry["added_weight_kg"] is None


async def test_correct_set_updates_kind_specific_fields(migrated_client, auth_headers):
    client, _ = migrated_client
    plan = await create_plan(client, auth_headers)
    session = await start_session(client, auth_headers, plan["id"])
    exercise_id = session["exercises"][0]["id"]
    saved = await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": exercise_id,
            "set_number": 1,
            "weight_kg": 42.5,
            "reps": 8,
            "rpe": 7,
            "client_operation_id": "test-run-correct-rpe-1",
        },
        headers=auth_headers,
    )
    entry_id = saved.json()["exercises"][0]["set_entries"][0]["id"]

    corrected = await client.put(
        f"{SESSIONS}/{session['id']}/sets/{entry_id}",
        json={"weight_kg": 42.5, "reps": 8, "rpe": 9},
        headers=auth_headers,
    )
    assert corrected.status_code == 200
    assert corrected.json()["exercises"][0]["set_entries"][0]["rpe"] == 9

    legacy_correction = await client.put(
        f"{SESSIONS}/{session['id']}/sets/{entry_id}",
        json={"weight_kg": 45, "reps": 7, "rir": 2},
        headers=auth_headers,
    )
    assert legacy_correction.status_code == 200
    entry = legacy_correction.json()["exercises"][0]["set_entries"][0]
    assert (entry["weight_kg"], entry["reps"], entry["rir"], entry["rpe"]) == (45, 7, 2, 9)

    cleared = await client.put(
        f"{SESSIONS}/{session['id']}/sets/{entry_id}",
        json={"weight_kg": 45, "reps": 7, "rir": 2, "rpe": None},
        headers=auth_headers,
    )
    assert cleared.status_code == 200
    entry = cleared.json()["exercises"][0]["set_entries"][0]
    assert entry["rpe"] is None
    assert entry["rir"] == 2


async def test_delete_session_removes_it_for_test_data_cleanup(client, auth_headers):
    plan = await create_plan(client, auth_headers)
    session = await start_session(client, auth_headers, plan["id"])
    session_id = UUID(session["id"])

    deleted = await client.delete(f"{SESSIONS}/{session_id}", headers=auth_headers)
    assert deleted.status_code == 204

    missing = await client.get(f"{SESSIONS}/{session_id}", headers=auth_headers)
    assert missing.status_code == 404
