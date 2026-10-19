"""Starting a workout suggests the next load and reps by double progression."""

LOGS = "/api/v1/logs"
PLANS = "/api/v1/plans"
SESSIONS = "/api/v1/workout-sessions"
EXERCISES = "/api/v1/exercises"


async def make_plan(client, headers, exercises):
    response = await client.post(
        PLANS,
        json={
            "name": "Progression plan",
            "exercises": [
                {
                    "exercise_name": name,
                    "target_sets": 3,
                    "target_reps_min": reps_min,
                    "target_reps_max": reps_max,
                    "target_weight_kg": weight,
                }
                for name, reps_min, reps_max, weight in exercises
            ],
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def log(client, headers, plan_id, day, name, reps, weight):
    response = await client.post(
        LOGS,
        json={
            "source_plan_id": plan_id,
            "performed_at": f"2026-10-{day:02d}T08:00:00Z",
            "total_time_minutes": 30,
            "overall_feeling": 4,
            "exercises": [
                {
                    "exercise_name": name,
                    "sets_count": len(reps),
                    "reps_per_set": reps,
                    "weight_kg": weight,
                    "rest_time_seconds": 90,
                }
            ],
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text


async def start(client, headers, plan_id):
    response = await client.post(SESSIONS, json={"source_plan_id": plan_id}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def by_name(session):
    return {item["exercise_name"]: item for item in session["exercises"]}


async def test_first_session_follows_the_plan(client, auth_headers):
    plan = await make_plan(client, auth_headers, [("Back squat", 5, 8, 60)])
    squat = by_name(await start(client, auth_headers, plan["id"]))["Back squat"]
    assert (squat["suggested_weight_kg"], squat["suggested_reps"]) == (60, 5)
    assert squat["suggestion_source"] == "plan"
    assert squat["suggestion_note"] is None


async def test_top_of_the_range_adds_two_and_a_half_on_lower_barbell_and_one_elsewhere(
    client, auth_headers
):
    plan = await make_plan(
        client, auth_headers, [("Back squat", 5, 8, 60), ("Dumbbell row", 8, 12, 20)]
    )
    await log(client, auth_headers, plan["id"], 1, "Back squat", [8, 8, 8], 80)
    await log(client, auth_headers, plan["id"], 2, "Dumbbell row", [12, 12, 12], 22)

    exercises = by_name(await start(client, auth_headers, plan["id"]))
    squat, row = exercises["Back squat"], exercises["Dumbbell row"]
    assert (squat["suggested_weight_kg"], squat["suggested_reps"]) == (82.5, 5)
    assert squat["suggestion_note"] == "+2.5 kg: every set reached 8 reps"
    assert (row["suggested_weight_kg"], row["suggested_reps"]) == (23, 8)


async def test_catalogue_equipment_decides_the_increment(client, auth_headers):
    created = await client.post(
        EXERCISES,
        json={
            "name": "Test split squat",
            "primary_muscles": ["quads"],
            "equipment_any_of": [["dumbbell"]],
        },
        headers=auth_headers,
    )
    assert created.status_code == 201
    plan = await make_plan(client, auth_headers, [("Test split squat", 6, 10, 16)])
    await log(client, auth_headers, plan["id"], 1, "Test split squat", [10, 10, 10], 16)
    squat = by_name(await start(client, auth_headers, plan["id"]))["Test split squat"]
    assert squat["suggested_weight_kg"] == 17


async def test_inside_the_range_keeps_the_load_and_adds_a_rep(client, auth_headers):
    plan = await make_plan(client, auth_headers, [("Back squat", 5, 8, 60)])
    await log(client, auth_headers, plan["id"], 1, "Back squat", [7, 6, 6], 80)
    squat = by_name(await start(client, auth_headers, plan["id"]))["Back squat"]
    assert (squat["suggested_weight_kg"], squat["suggested_reps"]) == (80, 7)
    assert squat["suggestion_note"] == "Same load, aim for 7 reps"


async def test_two_misses_in_a_row_drop_ten_percent(client, auth_headers):
    plan = await make_plan(client, auth_headers, [("Back squat", 5, 8, 60)])
    await log(client, auth_headers, plan["id"], 1, "Back squat", [4, 4, 3], 80)
    await log(client, auth_headers, plan["id"], 3, "Back squat", [5, 4, 4], 80)
    squat = by_name(await start(client, auth_headers, plan["id"]))["Back squat"]
    assert (squat["suggested_weight_kg"], squat["suggested_reps"]) == (72.5, 5)


async def log_live_session(client, headers, plan_id, weight, reps, rirs):
    session = await start(client, headers, plan_id)
    exercise = session["exercises"][0]
    for number, (rep, rir) in enumerate(zip(reps, rirs, strict=True), start=1):
        logged = await client.post(
            f"{SESSIONS}/{session['id']}/sets",
            json={
                "session_exercise_id": exercise["id"],
                "set_number": number,
                "weight_kg": weight,
                "reps": rep,
                "rir": rir,
                "state": "completed",
                "client_operation_id": f"progression-{session['id']}-{number}",
            },
            headers=headers,
        )
        assert logged.status_code == 201, logged.text
    completed = await client.post(
        f"{SESSIONS}/{session['id']}/complete", json={"overall_feeling": 4}, headers=headers
    )
    assert completed.status_code == 200, completed.text


async def test_rir_from_a_live_session_gates_the_increase(client, auth_headers):
    plan = await make_plan(client, auth_headers, [("Back squat", 5, 8, 80)])
    await log_live_session(client, auth_headers, plan["id"], 80, [8, 8, 8], [2, 1, 0])
    squat = (await start(client, auth_headers, plan["id"]))["exercises"][0]
    assert (squat["suggested_weight_kg"], squat["suggested_reps"]) == (80, 8)
    assert squat["suggestion_note"] == "Same load: the last sets had no reps in reserve"


async def test_rir_in_reserve_from_a_live_session_adds_load(client, auth_headers):
    plan = await make_plan(client, auth_headers, [("Back squat", 5, 8, 80)])
    await log_live_session(client, auth_headers, plan["id"], 80, [8, 8, 8], [2, 2, 1])
    squat = (await start(client, auth_headers, plan["id"]))["exercises"][0]
    assert squat["suggested_weight_kg"] == 82.5


async def test_swap_progresses_from_the_new_exercise_s_history(client, auth_headers):
    plan = await make_plan(client, auth_headers, [("Back squat", 5, 8, 80)])
    await log(client, auth_headers, None, 1, "Front squat", [6, 6, 5], 60)
    session = await start(client, auth_headers, plan["id"])
    swapped = await client.patch(
        f"{SESSIONS}/{session['id']}/exercises/{session['exercises'][0]['id']}",
        json={"exercise_name": "Front squat", "exercise_kind": "strength"},
        headers=auth_headers,
    )
    assert swapped.status_code == 200
    front = swapped.json()["exercises"][0]
    assert (front["suggested_weight_kg"], front["suggested_reps"]) == (60, 6)
    assert front["suggestion_note"] == "Same load, aim for 6 reps"


async def test_completed_session_keeps_each_set_s_weight_and_rir(client, auth_headers):
    plan = await make_plan(client, auth_headers, [("Back squat", 5, 8, 80)])
    await log_live_session(client, auth_headers, plan["id"], 80, [8, 8, 8], [2, 1, 0])
    logs = (await client.get(LOGS, headers=auth_headers)).json()["items"]
    exercise = logs[0]["exercises"][0]
    assert exercise["weight_per_set"] == [80, 80, 80]
    assert exercise["rir_per_set"] == [2, 1, 0]


async def test_editing_a_finished_session_s_rir_changes_the_next_suggestion(client, auth_headers):
    plan = await make_plan(client, auth_headers, [("Back squat", 5, 8, 80)])
    await log_live_session(client, auth_headers, plan["id"], 80, [8, 8, 8], [2, 1, 0])
    logged = (await client.get(LOGS, headers=auth_headers)).json()["items"][0]
    exercise = logged["exercises"][0]
    exercise["rir_per_set"] = [2, 2, 1]

    edited = await client.patch(
        f"{LOGS}/{logged['id']}", json={"exercises": [exercise]}, headers=auth_headers
    )
    assert edited.status_code == 200, edited.text

    squat = (await start(client, auth_headers, plan["id"]))["exercises"][0]
    assert squat["suggested_weight_kg"] == 82.5
