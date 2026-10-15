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


async def test_focus_follows_superset_rounds(client, auth_headers):
    """A superset is done back to back: after Row set 1 comes Push-up set 1,
    not Row set 2, so the phone HUD advances to the exercise actually next."""
    _, session = await create_session(client, auth_headers)
    squat, row, push_up = session["exercises"]

    async def log(exercise: dict, set_number: int) -> dict:
        response = await client.post(
            f"{SESSIONS}/{session['id']}/sets",
            json={
                "session_exercise_id": exercise["id"],
                "set_number": set_number,
                "weight_kg": 40,
                "reps": 8,
                "rir": 2,
                "state": "completed",
                "client_operation_id": f"rounds-{exercise['id']}-{set_number}",
            },
            headers=auth_headers,
        )
        assert response.status_code == 201
        body = response.json()
        return {"exercise": body["focused_exercise_id"], "set": body["focused_set_number"]}

    assert await log(squat, 1) == {"exercise": squat["id"], "set": 2}
    assert await log(squat, 2) == {"exercise": row["id"], "set": 1}
    assert await log(row, 1) == {"exercise": push_up["id"], "set": 1}
    assert await log(push_up, 1) == {"exercise": row["id"], "set": 2}
    assert await log(row, 2) == {"exercise": push_up["id"], "set": 2}


async def test_add_set_grows_one_exercise_for_this_session_only(client, auth_headers):
    plan, session = await create_session(client, auth_headers)
    squat = session["exercises"][0]

    added = await client.post(
        f"{SESSIONS}/{session['id']}/exercises/{squat['id']}/sets", headers=auth_headers
    )

    assert added.status_code == 200
    body = added.json()
    assert body["exercises"][0]["target_sets"] == 3
    assert body["focused_exercise_id"] == squat["id"]
    assert body["focused_set_number"] == 3
    logged = await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": squat["id"],
            "set_number": 3,
            "weight_kg": 80,
            "reps": 5,
            "state": "completed",
            "client_operation_id": "added-set-3",
        },
        headers=auth_headers,
    )
    assert logged.status_code == 201
    stored_plan = await client.get(f"{PLANS}/{plan['id']}", headers=auth_headers)
    assert stored_plan.json()["exercises"][0]["target_sets"] == 2


async def test_add_set_stops_at_the_limit(client, auth_headers):
    _, session = await create_session(client, auth_headers)
    squat = session["exercises"][0]
    url = f"{SESSIONS}/{session['id']}/exercises/{squat['id']}/sets"
    for _ in range(18):
        assert (await client.post(url, headers=auth_headers)).status_code == 200

    refused = await client.post(url, headers=auth_headers)

    assert refused.status_code == 409
    assert refused.json()["code"] == "SET_LIMIT_REACHED"


async def test_swap_replaces_an_unlogged_exercise_with_its_own_history(client, auth_headers):
    history = await client.post(
        "/api/v1/logs",
        json={
            "performed_at": "2026-10-01T08:00:00Z",
            "total_time_minutes": 30,
            "overall_feeling": 4,
            "exercises": [
                {
                    "exercise_name": "Goblet squat",
                    "sets_count": 2,
                    "reps_per_set": [12, 10],
                    "weight_kg": 24,
                    "rest_time_seconds": 60,
                }
            ],
        },
        headers=auth_headers,
    )
    assert history.status_code == 201
    plan, session = await create_session(client, auth_headers)
    squat, row, _ = session["exercises"]

    swapped = await client.patch(
        f"{SESSIONS}/{session['id']}/exercises/{squat['id']}",
        json={"exercise_name": "  goblet squat ", "exercise_kind": "strength"},
        headers=auth_headers,
    )
    assert swapped.status_code == 200
    first = swapped.json()["exercises"][0]
    assert first["exercise_name"] == "goblet squat"
    assert (first["suggested_weight_kg"], first["suggested_reps"]) == (24, 12)
    assert first["suggestion_source"] == "history"

    unknown = await client.patch(
        f"{SESSIONS}/{session['id']}/exercises/{row['id']}",
        json={"exercise_name": "Ring row", "exercise_kind": "bodyweight"},
        headers=auth_headers,
    )
    second = unknown.json()["exercises"][1]
    assert (second["exercise_kind"], second["suggested_weight_kg"]) == ("bodyweight", None)
    assert second["suggestion_source"] == "plan"
    # The plan keeps its own exercises.
    stored_plan = await client.get(f"{PLANS}/{plan['id']}", headers=auth_headers)
    assert stored_plan.json()["exercises"][0]["exercise_name"] == "Squat"


async def test_swap_refuses_an_exercise_with_logged_sets(client, auth_headers):
    _, session = await create_session(client, auth_headers)
    squat = session["exercises"][0]
    await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": squat["id"],
            "set_number": 1,
            "weight_kg": 80,
            "reps": 5,
            "state": "completed",
            "client_operation_id": "swap-blocked-1",
        },
        headers=auth_headers,
    )

    refused = await client.patch(
        f"{SESSIONS}/{session['id']}/exercises/{squat['id']}",
        json={"exercise_name": "Front squat"},
        headers=auth_headers,
    )
    blank = await client.patch(
        f"{SESSIONS}/{session['id']}/exercises/{squat['id']}",
        json={"exercise_name": "   "},
        headers=auth_headers,
    )

    assert refused.status_code == 409
    assert refused.json()["code"] == "EXERCISE_HAS_SETS"
    assert blank.status_code == 422
