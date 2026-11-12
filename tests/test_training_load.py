from datetime import UTC, datetime
from uuid import uuid4

API = "/api/v1"


async def test_weekly_external_volume_uses_real_sets_and_local_week_boundaries(
    migrated_client, app_engine, auth_headers
):
    client, _ = migrated_client
    tag = f"[TEST_RUN_ID:{uuid4()}]"
    cleanup = []
    try:
        exercise = await client.post(
            f"{API}/exercises",
            headers=auth_headers,
            json={
                "name": f"{tag} Split squat",
                "aliases": [f"{tag} Lunge"],
                "primary_muscles": ["quads", "glutes", "glutes"],
                "secondary_muscles": ["hamstrings"],
                "equipment_load_mode": "pair_db",
                "is_unilateral": True,
            },
        )
        assert exercise.status_code == 201
        cleanup.append(f"{API}/exercises/{exercise.json()['id']}")

        def lifted(name, reps, weight=None, weights=None):
            return {
                "exercise_name": f"{tag} {name}",
                "sets_count": len(reps),
                "weight_kg": weight,
                "weight_per_set": weights,
                "reps_per_set": reps,
            }

        for performed_at, activity, exercises in [
            ("2026-10-18T21:59:59Z", None, [lifted("Press", [3], weight=40)]),
            (
                "2026-10-18T22:00:00Z",
                None,
                [lifted("Lunge", [8, 6], weights=[5, 7.5125]), lifted("Push-up", [12])],
            ),
            ("2026-10-21T12:00:00Z", "running", []),
            ("2026-10-25T23:00:00Z", None, [lifted("Row", [8], weight=100)]),
        ]:
            response = await client.post(
                f"{API}/logs",
                headers=auth_headers,
                json={
                    "performed_at": performed_at,
                    "total_time_minutes": 30,
                    "overall_feeling": 3,
                    "notes": tag,
                    "activity_type": activity,
                    "effort_rpe": 4 if activity else None,
                    "exercises": exercises,
                },
            )
            assert response.status_code == 201
            cleanup.append(f"{API}/logs/{response.json()['id']}")

        params = {"week_of": "2026-10-25", "weeks": 3, "timezone": "Europe/Prague"}
        summary = await client.get(f"{API}/training-load", params=params, headers=auth_headers)
        assert summary.status_code == 200
        expected = {
            "timezone": "Europe/Prague",
            "weeks": [
                {
                    "week_start": "2026-10-05",
                    "gym_sessions": 0,
                    "logged_sets": 0,
                    "volume_kg": 0,
                    "muscle_volume": [],
                    "session_effort": {
                        "logged_sessions": 0,
                        "rated_sessions": 0,
                        "rated_minutes": 0,
                        "load_au": None,
                    },
                },
                {
                    "week_start": "2026-10-12",
                    "gym_sessions": 1,
                    "logged_sets": 1,
                    "volume_kg": 120,
                    "muscle_volume": [{"muscle": None, "volume_kg": 120}],
                    "session_effort": {
                        "logged_sessions": 1,
                        "rated_sessions": 0,
                        "rated_minutes": 0,
                        "load_au": None,
                    },
                },
                {
                    "week_start": "2026-10-19",
                    "gym_sessions": 1,
                    "logged_sets": 3,
                    "volume_kg": 340.3,
                    "muscle_volume": [
                        {"muscle": "glutes", "volume_kg": 170.2},
                        {"muscle": "quads", "volume_kg": 170.1},
                    ],
                    "session_effort": {
                        "logged_sessions": 2,
                        "rated_sessions": 1,
                        "rated_minutes": 30,
                        "load_au": 120,
                    },
                },
            ],
        }
        result = summary.json()
        assert result["timezone"] == expected["timezone"]
        for actual, expected_week in zip(result["weeks"], expected["weeks"], strict=True):
            assert {key: actual[key] for key in expected_week} == expected_week

        for invalid in [{"weeks": 27}, {"timezone": "Nowhere"}, {"week_of": "9999-12-31"}]:
            response = await client.get(
                f"{API}/training-load", params={**params, **invalid}, headers=auth_headers
            )
            assert response.status_code == 422, invalid
    finally:
        for url in reversed(cleanup):
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404


async def test_weekly_external_volume_is_grouped_by_primary_movement_pattern(
    migrated_client, auth_headers
):
    client, _ = migrated_client
    tag = f"[TEST_RUN_ID:{uuid4()}]"
    cleanup = []
    try:
        for name, alias, pattern in [
            (f"{tag} Back squat", f"{tag} Squat", "squat"),
            (f"{tag} Deadlift", f"{tag} Hinge", "hinge"),
        ]:
            exercise = await client.post(
                f"{API}/exercises",
                headers=auth_headers,
                json={"name": name, "aliases": [alias], "movement_pattern": pattern},
            )
            assert exercise.status_code == 201
            cleanup.append(f"{API}/exercises/{exercise.json()['id']}")

        for name, weight, reps in [
            (f"{tag} Squat", 100, 5),
            (f"{tag} Hinge", 80, 3),
            (f"{tag} Unclassified press", 50, 2),
        ]:
            log = await client.post(
                f"{API}/logs",
                headers=auth_headers,
                json={
                    "performed_at": "2026-10-19T12:00:00Z",
                    "total_time_minutes": 45,
                    "overall_feeling": 3,
                    "notes": tag,
                    "exercises": [
                        {
                            "exercise_name": name,
                            "sets_count": 1,
                            "weight_kg": weight,
                            "reps_per_set": [reps],
                        }
                    ],
                },
            )
            assert log.status_code == 201
            cleanup.append(f"{API}/logs/{log.json()['id']}")

        response = await client.get(
            f"{API}/training-load",
            params={"week_of": "2026-10-19", "weeks": 1, "timezone": "UTC"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        [week] = response.json()["weeks"]
        assert week["volume_kg"] == 840
        assert week["movement_pattern_volume"] == [
            {"movement_pattern": "squat", "volume_kg": 500},
            {"movement_pattern": "hinge", "volume_kg": 240},
            {"movement_pattern": None, "volume_kg": 100},
        ]
        assert (
            sum(item["volume_kg"] for item in week["movement_pattern_volume"]) == week["volume_kg"]
        )
    finally:
        for url in reversed(cleanup):
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404


async def test_weekly_rir_distribution_counts_known_and_unreported_sets(
    migrated_client, auth_headers
):
    client, _ = migrated_client
    tag = f"[TEST_RUN_ID:{uuid4()}]"
    cleanup = []
    try:
        log = await client.post(
            f"{API}/logs",
            headers=auth_headers,
            json={
                "performed_at": "2026-10-19T12:00:00Z",
                "total_time_minutes": 45,
                "overall_feeling": 3,
                "notes": tag,
                "exercises": [
                    {
                        "exercise_name": f"{tag} Rated sets",
                        "sets_count": 4,
                        "weight_kg": 50,
                        "reps_per_set": [8, 8, 8, 8],
                        "rir_per_set": [0, 2, None, 10],
                    },
                    {
                        "exercise_name": f"{tag} Unrated sets",
                        "sets_count": 2,
                        "weight_kg": 30,
                        "reps_per_set": [10, 10],
                    },
                ],
            },
        )
        assert log.status_code == 201
        log_url = f"{API}/logs/{log.json()['id']}"
        cleanup.append(log_url)

        response = await client.get(
            f"{API}/training-load",
            params={"week_of": "2026-10-19", "weeks": 1, "timezone": "UTC"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        [week] = response.json()["weeks"]
        assert week["logged_sets"] == 6
        assert week["rir_distribution"] == [
            {"rir": 0, "sets": 1},
            {"rir": 2, "sets": 1},
            {"rir": 10, "sets": 1},
            {"rir": None, "sets": 3},
        ]
        assert sum(item["sets"] for item in week["rir_distribution"]) == week["logged_sets"]
    finally:
        for url in cleanup:
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404


async def test_calendar_workload_ratio_uses_prior_weeks_and_requires_coverage(
    migrated_client, app_engine, auth_headers
):
    client, _ = migrated_client
    tag = f"[TEST_RUN_ID:{uuid4()}]"
    cleanup = []
    params = {"week_of": "2024-02-05", "weeks": 1}
    try:
        for day, minutes, rating in [
            ("2024-01-08", 20, 2),
            ("2024-01-15", 20, 4),
            ("2024-01-22", 20, 6),
            ("2024-01-29", 20, 8),
            ("2024-02-05", 30, 6),
        ]:
            response = await client.post(
                f"{API}/logs",
                headers=auth_headers,
                json={
                    "performed_at": f"{day}T12:00:00Z",
                    "total_time_minutes": minutes,
                    "overall_feeling": 3,
                    "effort_rpe": rating,
                    "activity_type": "running",
                    "notes": tag,
                },
            )
            assert response.status_code == 201
            cleanup.append(f"{API}/logs/{response.json()['id']}")

        async def read_ratio(query):
            response = await client.get(f"{API}/training-load", params=query, headers=auth_headers)
            assert response.status_code == 200
            [week] = response.json()["weeks"]
            return week["workload_ratio"]

        assert await read_ratio(params) == {
            "status": "ready",
            "baseline_start": "2024-01-08",
            "baseline_mean_au": 100,
            "ratio": 1.8,
        }
        updated = await client.patch(cleanup[1], headers=auth_headers, json={"effort_rpe": None})
        assert updated.status_code == 200
        unrated = await read_ratio(params)
        assert unrated["status"] == "missing_ratings"
        assert unrated["ratio"] is None
        removed = cleanup.pop(1)
        assert (await client.delete(removed, headers=auth_headers)).status_code == 204
        assert (await client.get(removed, headers=auth_headers)).status_code == 404
        missing = await read_ratio(params)
        assert missing["status"] == "missing_sessions"
        assert missing["ratio"] is None
        current = await read_ratio({**params, "week_of": datetime.now(UTC).date().isoformat()})
        assert current["status"] == "week_incomplete"
        assert current["ratio"] is None
        early = await read_ratio({**params, "week_of": "0001-01-29", "timezone": "Europe/Prague"})
        assert early["status"] == "missing_sessions"
        assert early["ratio"] is None
    finally:
        for url in reversed(cleanup):
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404
