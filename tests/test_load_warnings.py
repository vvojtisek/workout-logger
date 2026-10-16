"""Heavy leg work scheduled shortly before hockey is flagged on the calendar,
with a date to move it to and lighter plans to swap in."""

CALENDAR = "/api/v1/calendar"
EXERCISES = "/api/v1/exercises"
LOAD_EVENTS = "/api/v1/load-events"
PLANS = "/api/v1/plans"
SCHEDULED = "/api/v1/scheduled-workouts"
OCTOBER = f"{CALENDAR}?from=2026-10-01&to=2026-10-31"


async def add_exercise(client, headers, name, primary, aliases=()):
    response = await client.post(
        EXERCISES,
        json={"name": name, "aliases": list(aliases), "primary_muscles": list(primary)},
        headers=headers,
    )
    assert response.status_code == 201, response.text


async def add_plan(client, headers, name, exercises):
    response = await client.post(
        PLANS,
        json={
            "name": name,
            "exercises": [
                {
                    "exercise_name": exercise,
                    "target_sets": 3,
                    "target_reps_min": reps_min,
                    "target_reps_max": reps_min + 3,
                    **({"exercise_kind": kind} if kind else {}),
                }
                for exercise, reps_min, kind in exercises
            ],
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def add_event(client, headers, kind, weekday, start_time, name=None):
    response = await client.post(
        LOAD_EVENTS,
        json={
            "name": name or kind.title(),
            "kind": kind,
            "weekday": weekday,
            "start_time": start_time,
            "season_start": "2026-09-01",
            "season_end": "2027-03-31",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def schedule(client, headers, plan_id, day):
    response = await client.post(
        SCHEDULED, json={"workout_plan_id": plan_id, "scheduled_date": day}, headers=headers
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def warnings(client, headers, url=OCTOBER):
    response = await client.get(url, headers=headers)
    assert response.status_code == 200
    return {item["scheduled_workout_id"]: item for item in response.json()["load_warnings"]}


async def seed(client, headers):
    await add_exercise(client, headers, "Test Back Squat", ["quads", "glutes"])
    await add_exercise(client, headers, "Test Bench Press", ["chest"])
    await add_exercise(client, headers, "Test Romanian Deadlift", ["hamstrings"], ["Test RDL"])
    heavy = await add_plan(
        client, headers, "Legs heavy", [("Test Back Squat", 5, None), ("Test Bench Press", 8, None)]
    )
    upper = await add_plan(client, headers, "Upper", [("Test Bench Press", 5, None)])
    return heavy, upper


async def test_heavy_legs_the_day_before_or_the_day_of_a_game_are_flagged(client, auth_headers):
    heavy, _ = await seed(client, auth_headers)
    game_id = await add_event(client, auth_headers, "game", 5, "19:30", "League game")  # Saturdays
    friday = await schedule(client, auth_headers, heavy, "2026-10-16")
    saturday = await schedule(client, auth_headers, heavy, "2026-10-24")
    thursday = await schedule(client, auth_headers, heavy, "2026-10-08")

    found = await warnings(client, auth_headers)
    assert set(found) == {friday, saturday}
    warning = found[friday]
    assert warning["heavy_exercises"] == ["Test Back Squat"]
    assert [(event["event_id"], event["date"], event["kind"]) for event in warning["events"]] == [
        (game_id, "2026-10-17", "game")
    ]
    assert thursday not in found


async def test_practice_counts_the_same_day_or_the_next_morning(client, auth_headers):
    heavy, _ = await seed(client, auth_headers)
    await add_event(client, auth_headers, "practice", 1, "07:00")  # Tuesday mornings
    await add_event(client, auth_headers, "practice", 3, "20:15")  # Thursday evenings
    monday = await schedule(client, auth_headers, heavy, "2026-10-12")
    wednesday = await schedule(client, auth_headers, heavy, "2026-10-14")
    thursday = await schedule(client, auth_headers, heavy, "2026-10-22")

    found = await warnings(client, auth_headers)
    assert monday in found
    assert thursday in found
    # Thursday's practice is at 20:15, more than 12 hours after any Wednesday workout.
    assert wednesday not in found


async def test_only_heavy_strength_leg_work_counts(client, auth_headers):
    await seed(client, auth_headers)
    await add_event(client, auth_headers, "game", 5, "19:30")
    light_legs = await add_plan(client, auth_headers, "Light legs", [("Test Back Squat", 8, None)])
    heavy_upper = await add_plan(
        client, auth_headers, "Heavy upper", [("Test Bench Press", 3, None)]
    )
    hinge_alias = await add_plan(client, auth_headers, "Hinge", [("test rdl", 6, None)])
    uncatalogued = await add_plan(client, auth_headers, "Front", [("Front squat", 4, None)])
    unknown = await add_plan(client, auth_headers, "Mystery", [("Mystery move", 3, None)])
    cardio = await add_plan(client, auth_headers, "Bike", [("Leg press ride", 3, "cardio")])

    ids = {
        name: await schedule(client, auth_headers, plan, "2026-10-16")
        for name, plan in {
            "light_legs": light_legs,
            "heavy_upper": heavy_upper,
            "hinge_alias": hinge_alias,
            "uncatalogued": uncatalogued,
            "unknown": unknown,
            "cardio": cardio,
        }.items()
    }
    found = await warnings(client, auth_headers)
    flagged = {name for name, scheduled_id in ids.items() if scheduled_id in found}
    assert flagged == {"hinge_alias", "uncatalogued"}
    assert found[ids["hinge_alias"]]["heavy_exercises"] == ["test rdl"]


async def test_skipped_workouts_are_not_flagged(client, auth_headers):
    heavy, _ = await seed(client, auth_headers)
    await add_event(client, auth_headers, "game", 5, "19:30")
    friday = await schedule(client, auth_headers, heavy, "2026-10-16")
    skipped = await client.patch(
        f"{SCHEDULED}/{friday}", json={"status": "skipped"}, headers=auth_headers
    )
    assert skipped.status_code == 200
    assert await warnings(client, auth_headers) == {}


async def test_an_event_just_after_the_range_still_counts(client, auth_headers):
    heavy, _ = await seed(client, auth_headers)
    await add_event(client, auth_headers, "game", 5, "19:30")
    # Friday 30 October; the game is on Saturday 31 October, outside the range.
    friday = await schedule(client, auth_headers, heavy, "2026-10-30")
    found = await warnings(client, auth_headers, f"{CALENDAR}?from=2026-10-01&to=2026-10-30")
    assert found[friday]["events"][0]["date"] == "2026-10-31"


async def test_warning_offers_a_free_day_and_lighter_plans(client, auth_headers):
    heavy, upper = await seed(client, auth_headers)
    await add_event(client, auth_headers, "game", 5, "19:30")
    friday = await schedule(client, auth_headers, heavy, "2026-10-16")
    # Thursday is taken, so the nearest free day without a clash is Wednesday.
    await schedule(client, auth_headers, upper, "2026-10-15")

    warning = (await warnings(client, auth_headers))[friday]
    assert warning["move_to"] == "2026-10-14"
    assert warning["swap_plans"] == [{"id": upper, "name": "Upper"}]


async def test_swapping_the_plan_clears_the_warning(client, auth_headers):
    heavy, upper = await seed(client, auth_headers)
    await add_event(client, auth_headers, "game", 5, "19:30")
    friday = await schedule(client, auth_headers, heavy, "2026-10-16")

    swapped = await client.patch(
        f"{SCHEDULED}/{friday}", json={"workout_plan_id": upper}, headers=auth_headers
    )
    assert swapped.status_code == 200
    assert swapped.json()["workout_plan_id"] == upper
    assert swapped.json()["workout_plan_name"] == "Upper"
    assert await warnings(client, auth_headers) == {}


async def test_swap_rejects_an_unknown_plan(client, auth_headers):
    heavy, _ = await seed(client, auth_headers)
    friday = await schedule(client, auth_headers, heavy, "2026-10-16")
    response = await client.patch(
        f"{SCHEDULED}/{friday}",
        json={"workout_plan_id": "00000000-0000-0000-0000-000000000000"},
        headers=auth_headers,
    )
    assert response.status_code == 404
