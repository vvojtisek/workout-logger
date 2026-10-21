from datetime import UTC, datetime

import pytest

from app.services.volume import VolumeRule, set_volume_kg, sets_volume_kg, total_reps

EXERCISES = "/api/v1/exercises"
LOGS = "/api/v1/logs"
PLANS = "/api/v1/plans"
SESSIONS = "/api/v1/workout-sessions"

PAIR = VolumeRule("pair_db", False)
SINGLE_PER_SIDE = VolumeRule("single_db", True)
PAIR_PER_SIDE = VolumeRule("pair_db", True)


@pytest.mark.parametrize(
    ("rule", "weight", "reps", "volume", "reps_total"),
    [
        # Barbell or machine: the typed weight is the whole load.
        (VolumeRule(), 80, 5, 400, 5),
        # DB bench press, 20 kg dumbbells: both move on every rep.
        (PAIR, 20, 10, 400, 10),
        # Alternating curl, 15 kg dumbbell, 10 reps each arm.
        (SINGLE_PER_SIDE, 15, 10, 300, 20),
        # Bulgarian split squat holding two 20 kg dumbbells, 8 reps each leg.
        (PAIR_PER_SIDE, 20, 8, 640, 16),
        # Bodyweight set: no load, so no volume, but the reps still count.
        (PAIR_PER_SIDE, None, 8, 0, 16),
    ],
)
def test_set_volume_and_reps_follow_the_rule(rule, weight, reps, volume, reps_total):
    assert set_volume_kg(weight, reps, rule) == volume
    assert total_reps(reps, rule) == reps_total


def test_sets_volume_sums_and_rounds():
    assert sets_volume_kg([(12.5, 10), (12.5, 9), (None, 5)], PAIR) == 475.0


async def create_exercise(client, auth_headers, name, mode, unilateral):
    response = await client.post(
        EXERCISES,
        json={"name": name, "equipment_load_mode": mode, "is_unilateral": unilateral},
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_exercise_stores_and_validates_volume_rule(client, auth_headers):
    created = await create_exercise(client, auth_headers, "Test split squat", "pair_db", True)
    assert created["equipment_load_mode"] == "pair_db"
    assert created["is_unilateral"] is True

    plain = await client.post(EXERCISES, json={"name": "Test plain lift"}, headers=auth_headers)
    assert plain.json()["equipment_load_mode"] == "standard"
    assert plain.json()["is_unilateral"] is False

    bad = await client.post(
        EXERCISES,
        json={"name": "Test bad", "equipment_load_mode": "triple_db"},
        headers=auth_headers,
    )
    assert bad.status_code == 422


async def test_log_volume_follows_the_exercise_at_read_time(client, auth_headers):
    exercise = await create_exercise(client, auth_headers, "Test DB lunge", "standard", False)
    log = await client.post(
        LOGS,
        json={
            "performed_at": datetime(2026, 10, 19, 8, tzinfo=UTC).isoformat(),
            "total_time_minutes": 30,
            "overall_feeling": 4,
            "exercises": [
                {
                    # Matched without case to the catalogue name.
                    "exercise_name": "test db lunge",
                    "sets_count": 2,
                    "reps_per_set": [10, 8],
                    "weight_kg": 20,
                },
                {
                    "exercise_name": "Not in the catalogue",
                    "sets_count": 1,
                    "reps_per_set": [5],
                    "weight_kg": 100,
                },
            ],
        },
        headers=auth_headers,
    )
    assert log.status_code == 201
    body = log.json()
    assert body["exercises"][0]["volume_kg"] == 360
    assert body["exercises"][1]["volume_kg"] == 500
    assert body["total_volume_kg"] == 860

    # Marking the exercise as two dumbbells, per leg, changes the past log too.
    replaced = await client.put(
        f"{EXERCISES}/{exercise['id']}",
        json={"name": "Test DB lunge", "equipment_load_mode": "pair_db", "is_unilateral": True},
        headers=auth_headers,
    )
    assert replaced.status_code == 200
    reread = (await client.get(f"{LOGS}/{body['id']}", headers=auth_headers)).json()
    lunge = reread["exercises"][0]
    assert lunge["weight_kg"] == 20
    assert lunge["reps_per_set"] == [10, 8]
    assert lunge["equipment_load_mode"] == "pair_db"
    assert lunge["is_unilateral"] is True
    assert lunge["total_reps"] == 36
    assert lunge["volume_kg"] == 1440
    assert reread["total_volume_kg"] == 1940

    listed = (await client.get(LOGS, headers=auth_headers)).json()["items"]
    assert [item["total_volume_kg"] for item in listed if item["id"] == body["id"]] == [1940]


async def test_alias_matches_and_owned_exercise_wins(client, auth_headers):
    await create_exercise(client, auth_headers, "Test alias curl", "single_db", True)
    await client.post(
        EXERCISES,
        json={
            "name": "Test curl variant",
            "aliases": ["Test alternating curl"],
            "equipment_load_mode": "single_db",
            "is_unilateral": True,
        },
        headers=auth_headers,
    )
    log = await client.post(
        LOGS,
        json={
            "performed_at": datetime(2026, 10, 19, 8, tzinfo=UTC).isoformat(),
            "total_time_minutes": 30,
            "overall_feeling": 3,
            "exercises": [
                {
                    "exercise_name": "Test alternating curl",
                    "sets_count": 1,
                    "reps_per_set": [10],
                    "weight_kg": 15,
                }
            ],
        },
        headers=auth_headers,
    )
    assert log.json()["exercises"][0]["volume_kg"] == 300


async def test_session_reports_volume_and_hints_for_completed_sets(client, auth_headers):
    await create_exercise(client, auth_headers, "Test Bulgarian", "pair_db", True)
    plan = await client.post(
        PLANS,
        json={
            "name": "Test volume plan",
            "exercises": [
                {
                    "exercise_name": "Test Bulgarian",
                    "target_sets": 2,
                    "target_reps_min": 8,
                    "target_reps_max": 10,
                    "target_weight_kg": 20,
                    "rest_time_seconds": 60,
                }
            ],
        },
        headers=auth_headers,
    )
    started = await client.post(
        SESSIONS, json={"source_plan_id": plan.json()["id"]}, headers=auth_headers
    )
    session = started.json()
    exercise = session["exercises"][0]
    assert exercise["equipment_load_mode"] == "pair_db"
    assert exercise["is_unilateral"] is True
    assert exercise["volume_kg"] == 0

    saved = await client.post(
        f"{SESSIONS}/{session['id']}/sets",
        json={
            "session_exercise_id": exercise["id"],
            "set_number": 1,
            "weight_kg": 20,
            "reps": 8,
            "client_operation_id": "test-volume-set-1",
        },
        headers=auth_headers,
    )
    body = saved.json()
    assert body["exercises"][0]["set_entries"][0]["weight_kg"] == 20
    assert body["exercises"][0]["total_reps"] == 16
    assert body["exercises"][0]["volume_kg"] == 640
    assert body["total_volume_kg"] == 640

    completed = await client.post(
        f"{SESSIONS}/{session['id']}/complete", json={"overall_feeling": 4}, headers=auth_headers
    )
    log_id = completed.json()["workout_log_id"]
    log = (await client.get(f"{LOGS}/{log_id}", headers=auth_headers)).json()
    assert log["exercises"][0]["weight_kg"] == 20
    assert log["total_volume_kg"] == 640


def test_log_volume_uses_per_set_weights_when_the_log_has_them():
    from app.models import ExerciseLog

    entry = ExerciseLog(exercise_name="Test press", reps_per_set=[10, 8], weight_kg=22)
    entry.volume_rule = PAIR
    assert entry.volume_kg == 2 * 22 * 18
    # Edited and newly completed logs store one weight per set.
    entry.weight_per_set = [20, 22]
    assert entry.volume_kg == 2 * (20 * 10 + 22 * 8)
