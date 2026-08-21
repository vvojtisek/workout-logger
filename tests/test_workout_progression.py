SESSIONS = "/api/v1/workout-sessions"
PLANS = "/api/v1/plans"


def multi_exercise_plan(name: str = "Slice 2 progression") -> dict:
    return {
        "name": name,
        "description": "full logging grid",
        "exercises": [
            {
                "exercise_name": "Squat",
                "target_sets": 2,
                "target_reps_min": 5,
                "target_reps_max": 8,
                "target_weight_kg": 80,
                "rest_time_seconds": 90,
            },
            {
                "exercise_name": "Row",
                "target_sets": 2,
                "target_reps_min": 8,
                "target_reps_max": 12,
                "target_weight_kg": 40,
                "rest_time_seconds": 60,
                "group_key": "superset-a",
                "group_order": 0,
            },
            {
                "exercise_name": "Push-up",
                "target_sets": 2,
                "target_reps_min": 10,
                "target_reps_max": 15,
                "target_weight_kg": 0,
                "rest_time_seconds": 60,
                "group_key": "superset-a",
                "group_order": 1,
            },
        ],
    }


async def create_session(client, auth_headers) -> tuple[dict, dict]:
    plan_response = await client.post(
        PLANS,
        json=multi_exercise_plan(),
        headers=auth_headers,
    )
    assert plan_response.status_code == 201
    plan = plan_response.json()
    session_response = await client.post(
        SESSIONS,
        json={"source_plan_id": plan["id"]},
        headers=auth_headers,
    )
    assert session_response.status_code == 201
    return plan, session_response.json()


async def test_start_snapshots_linked_group_metadata(client, auth_headers):
    plan, session = await create_session(client, auth_headers)

    assert [(item["group_key"], item["group_order"]) for item in plan["exercises"]] == [
        (None, None),
        ("superset-a", 0),
        ("superset-a", 1),
    ]
    assert [(item["group_key"], item["group_order"]) for item in session["exercises"]] == [
        (None, None),
        ("superset-a", 0),
        ("superset-a", 1),
    ]


async def test_complete_skip_and_navigation_advance_focus(client, auth_headers):
    _, session = await create_session(client, auth_headers)
    squat, row, _ = session["exercises"]

    completed = await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": squat["id"],
            "set_number": 1,
            "weight_kg": 82.5,
            "reps": 7,
            "rir": 2,
            "state": "completed",
            "client_operation_id": "slice-2-complete-squat-1",
        },
        headers=auth_headers,
    )
    assert completed.status_code == 201
    assert completed.json()["focused_exercise_id"] == squat["id"]
    assert completed.json()["focused_set_number"] == 2

    skipped = await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": squat["id"],
            "set_number": 2,
            "weight_kg": 80,
            "reps": 5,
            "rir": None,
            "state": "skipped",
            "client_operation_id": "slice-2-skip-squat-2",
        },
        headers=auth_headers,
    )
    assert skipped.status_code == 201
    body = skipped.json()
    assert body["focused_exercise_id"] == row["id"]
    assert body["focused_set_number"] == 1
    assert [entry["state"] for entry in body["exercises"][0]["set_entries"]] == [
        "completed",
        "skipped",
    ]

    moved = await client.patch(
        f"{SESSIONS}/{session['id']}/focus",
        json={"session_exercise_id": row["id"], "set_number": 2},
        headers=auth_headers,
    )
    assert moved.status_code == 200
    assert moved.json()["focused_exercise_id"] == row["id"]
    assert moved.json()["focused_set_number"] == 2


async def test_undo_and_permanent_correction_persist_exact_values(client, auth_headers):
    _, session = await create_session(client, auth_headers)
    exercise = session["exercises"][0]
    saved = await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": exercise["id"],
            "set_number": 1,
            "weight_kg": 81.25,
            "reps": 6,
            "rir": 3,
            "client_operation_id": "slice-2-correct-squat-1",
        },
        headers=auth_headers,
    )
    assert saved.status_code == 201
    entry_id = saved.json()["exercises"][0]["set_entries"][0]["id"]

    corrected = await client.put(
        f"{SESSIONS}/{session['id']}/sets/{entry_id}",
        json={"weight_kg": 83.75, "reps": 4, "rir": 1},
        headers=auth_headers,
    )
    assert corrected.status_code == 200
    entry = corrected.json()["exercises"][0]["set_entries"][0]
    assert (entry["weight_kg"], entry["reps"], entry["rir"]) == (83.75, 4, 1)

    undone = await client.delete(
        f"{SESSIONS}/{session['id']}/sets/{entry_id}",
        headers=auth_headers,
    )
    assert undone.status_code == 200
    body = undone.json()
    assert body["exercises"][0]["set_entries"] == []
    assert body["focused_exercise_id"] == exercise["id"]
    assert body["focused_set_number"] == 1
    assert body["rest_ends_at"] is None

    reloaded = await client.get(f"{SESSIONS}/{session['id']}", headers=auth_headers)
    assert reloaded.status_code == 200
    assert reloaded.json()["exercises"][0]["set_entries"] == []
