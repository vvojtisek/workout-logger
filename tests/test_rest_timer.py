from datetime import UTC, datetime

SESSIONS = "/api/v1/workout-sessions"
PLANS = "/api/v1/plans"


async def create_session(client, auth_headers, name: str = "Slice 3 timer") -> dict:
    plan_response = await client.post(
        PLANS,
        json={
            "name": name,
            "description": "rest timer resilience",
            "exercises": [
                {
                    "exercise_name": "Deadlift",
                    "target_sets": 3,
                    "target_reps_min": 5,
                    "target_reps_max": 8,
                    "target_weight_kg": 100,
                    "rest_time_seconds": 120,
                }
            ],
        },
        headers=auth_headers,
    )
    assert plan_response.status_code == 201
    session_response = await client.post(
        SESSIONS,
        json={"source_plan_id": plan_response.json()["id"]},
        headers=auth_headers,
    )
    assert session_response.status_code == 201
    return session_response.json()


async def save_set(
    client,
    auth_headers,
    session: dict,
    set_number: int,
    operation_id: str,
    state: str = "completed",
):
    return await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": session["exercises"][0]["id"],
            "set_number": set_number,
            "weight_kg": 102.5,
            "reps": 6,
            "rir": 2,
            "state": state,
            "client_operation_id": operation_id,
        },
        headers=auth_headers,
    )


async def test_completed_set_starts_exercise_rest_but_skipped_set_does_not(
    client, auth_headers
):
    session = await create_session(client, auth_headers)

    skipped = await save_set(
        client,
        auth_headers,
        session,
        1,
        "slice-3-skip-no-rest",
        state="skipped",
    )
    assert skipped.status_code == 201
    assert skipped.json()["rest_ends_at"] is None

    completed = await save_set(
        client,
        auth_headers,
        skipped.json(),
        2,
        "slice-3-complete-rest",
    )
    assert completed.status_code == 201
    remaining = datetime.fromisoformat(completed.json()["rest_ends_at"]) - datetime.now(UTC)
    assert 118 <= remaining.total_seconds() <= 120


async def test_rest_adjustment_clamps_at_zero_expires_and_can_be_skipped(client, auth_headers):
    session = await create_session(client, auth_headers)
    saved = await save_set(client, auth_headers, session, 1, "slice-3-adjust-rest")
    body = saved.json()
    original_end = datetime.fromisoformat(body["rest_ends_at"])

    extended = await client.patch(
        f"{SESSIONS}/{session['id']}/rest",
        json={"adjustment_seconds": 30, "expected_version": body["version"]},
        headers=auth_headers,
    )
    assert extended.status_code == 200
    extended_body = extended.json()
    assert (
        datetime.fromisoformat(extended_body["rest_ends_at"]) - original_end
    ).total_seconds() == 30

    expired = await client.patch(
        f"{SESSIONS}/{session['id']}/rest",
        json={"adjustment_seconds": -3600, "expected_version": extended_body["version"]},
        headers=auth_headers,
    )
    assert expired.status_code == 200
    expired_body = expired.json()
    expires_in = datetime.fromisoformat(expired_body["rest_ends_at"]) - datetime.now(UTC)
    assert -1 <= expires_in.total_seconds() <= 1

    skipped = await client.patch(
        f"{SESSIONS}/{session['id']}/rest",
        json={"skip": True, "expected_version": expired_body["version"]},
        headers=auth_headers,
    )
    assert skipped.status_code == 200
    assert skipped.json()["rest_ends_at"] is None


async def test_rest_validation_and_authorization(client, auth_headers):
    session = await create_session(client, auth_headers)
    path = f"{SESSIONS}/{session['id']}/rest"

    unauthorized = await client.patch(
        path,
        json={"adjustment_seconds": 30, "expected_version": session["version"]},
    )
    assert unauthorized.status_code == 401

    invalid = await client.patch(
        path,
        json={"adjustment_seconds": 0, "expected_version": session["version"]},
        headers=auth_headers,
    )
    assert invalid.status_code == 422

    no_timer = await client.patch(
        path,
        json={"adjustment_seconds": 30, "expected_version": session["version"]},
        headers=auth_headers,
    )
    assert no_timer.status_code == 409
    assert no_timer.json()["code"] == "REST_NOT_ACTIVE"


async def test_rest_adjustment_rejects_a_stale_session_version(client, auth_headers):
    session = await create_session(client, auth_headers)
    saved = await save_set(client, auth_headers, session, 1, "slice-3-version-rest")
    body = saved.json()
    original_end = body["rest_ends_at"]
    path = f"{SESSIONS}/{session['id']}/rest"
    payload = {"adjustment_seconds": 30, "expected_version": body["version"]}

    first = await client.patch(path, json=payload, headers=auth_headers)
    stale = await client.patch(path, json=payload, headers=auth_headers)

    assert first.status_code == 200
    assert first.json()["version"] == body["version"] + 1
    assert stale.status_code == 409
    assert stale.json()["code"] == "SESSION_VERSION_CONFLICT"
    reloaded = await client.get(f"{SESSIONS}/{session['id']}", headers=auth_headers)
    assert (
        datetime.fromisoformat(reloaded.json()["rest_ends_at"])
        - datetime.fromisoformat(original_end)
    ).total_seconds() == 30


async def test_idempotent_retry_keeps_one_set_one_deadline_and_one_version(client, auth_headers):
    session = await create_session(client, auth_headers)
    operation_id = "slice-3-idempotent-offline-retry"

    first = await save_set(client, auth_headers, session, 1, operation_id)
    retry = await save_set(client, auth_headers, session, 1, operation_id)

    assert first.status_code == 201
    assert retry.status_code == 200
    first_body = first.json()
    retry_body = retry.json()
    assert retry_body["rest_ends_at"] == first_body["rest_ends_at"]
    assert retry_body["version"] == first_body["version"]
    entries = retry_body["exercises"][0]["set_entries"]
    assert len(entries) == 1
    assert entries[0]["client_operation_id"] == operation_id
