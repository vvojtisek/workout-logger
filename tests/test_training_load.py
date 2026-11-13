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
                "aliases": [f"{tag} Lunge", f"{tag} Bodyweight lunge"],
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
                [
                    lifted("Lunge", [8, 6], weights=[5, 7.5125]),
                    lifted("Push-up", [12]),
                    lifted("Bodyweight lunge", [12, 10], weights=[0, 0]),
                ],
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
                    "training_variability": {
                        "status": "no_sessions",
                        "daily_mean_au": None,
                        "daily_sd_au": None,
                        "monotony": None,
                        "strain_au": None,
                        "daily_loads": [],
                    },
                },
                {
                    "week_start": "2026-10-12",
                    "gym_sessions": 1,
                    "logged_sets": 1,
                    "volume_kg": 120,
                    "muscle_volume": [{"muscle": None, "set_count": 1, "volume_kg": 120}],
                    "session_effort": {
                        "logged_sessions": 1,
                        "rated_sessions": 0,
                        "rated_minutes": 0,
                        "load_au": None,
                    },
                    "training_variability": {
                        "status": "missing_ratings",
                        "daily_mean_au": None,
                        "daily_sd_au": None,
                        "monotony": None,
                        "strain_au": None,
                        "daily_loads": [],
                    },
                },
                {
                    "week_start": "2026-10-19",
                    "gym_sessions": 1,
                    "logged_sets": 5,
                    "volume_kg": 340.3,
                    "muscle_volume": [
                        {"muscle": "glutes", "set_count": 4, "volume_kg": 170.2},
                        {"muscle": "quads", "set_count": 4, "volume_kg": 170.1},
                        {"muscle": None, "set_count": 1, "volume_kg": 0},
                    ],
                    "session_effort": {
                        "logged_sessions": 2,
                        "rated_sessions": 1,
                        "rated_minutes": 30,
                        "load_au": 120,
                    },
                    "training_variability": {
                        "status": "missing_ratings",
                        "daily_mean_au": None,
                        "daily_sd_au": None,
                        "monotony": None,
                        "strain_au": None,
                        "daily_loads": [],
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
            (f"{tag} Bodyweight pull", f"{tag} BW pull", "vertical_pull"),
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
            (f"{tag} BW pull", None, 8),
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
        assert week["movement_pattern_sets"] == [
            {"movement_pattern": "hinge", "sets": 1},
            {"movement_pattern": "squat", "sets": 1},
            {"movement_pattern": None, "sets": 1},
            {"movement_pattern": "vertical_pull", "sets": 1},
        ]
        assert (
            sum(item["volume_kg"] for item in week["movement_pattern_volume"]) == week["volume_kg"]
        )
        assert sum(item["sets"] for item in week["movement_pattern_sets"]) == week["logged_sets"]
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

        async def read_running_ratio(query):
            response = await client.get(f"{API}/training-load", params=query, headers=auth_headers)
            assert response.status_code == 200
            [week] = response.json()["weeks"]
            [running] = [
                activity
                for activity in week["session_effort_by_activity"]
                if activity["activity_type"] == "running"
            ]
            return running["workload_ratio"]

        assert await read_ratio(params) == {
            "status": "ready",
            "baseline_start": "2024-01-08",
            "baseline_mean_au": 100,
            "ratio": 1.8,
        }
        assert await read_running_ratio(params) == {
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
        assert (await read_running_ratio(params))["status"] == "missing_ratings"
        removed = cleanup.pop(1)
        assert (await client.delete(removed, headers=auth_headers)).status_code == 204
        assert (await client.get(removed, headers=auth_headers)).status_code == 404
        missing = await read_ratio(params)
        assert missing["status"] == "missing_sessions"
        assert missing["ratio"] is None
        assert (await read_running_ratio(params))["status"] == "missing_sessions"
        current = await read_ratio({**params, "week_of": datetime.now(UTC).date().isoformat()})
        assert current["status"] == "week_incomplete"
        assert current["ratio"] is None
        current_log = await client.post(
            f"{API}/logs",
            headers=auth_headers,
            json={
                "performed_at": datetime.now(UTC).isoformat(),
                "total_time_minutes": 20,
                "overall_feeling": 3,
                "effort_rpe": 5,
                "activity_type": "running",
                "notes": tag,
            },
        )
        assert current_log.status_code == 201
        cleanup.append(f"{API}/logs/{current_log.json()['id']}")
        assert (
            await read_running_ratio(
                {
                    **params,
                    "week_of": datetime.now(UTC).date().isoformat(),
                }
            )
        )["status"] == "week_incomplete"
        early = await read_ratio({**params, "week_of": "0001-01-29", "timezone": "Europe/Prague"})
        assert early["status"] == "missing_sessions"
        assert early["ratio"] is None
    finally:
        for url in reversed(cleanup):
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404


async def test_weekly_training_monotony_and_strain_use_all_seven_local_days(
    migrated_client, auth_headers
):
    client, _ = migrated_client
    tag = f"[TEST_RUN_ID:{uuid4()}]"
    cleanup = []
    try:
        for day in ["2026-10-19", "2026-10-21"]:
            response = await client.post(
                f"{API}/logs",
                headers=auth_headers,
                json={
                    "performed_at": f"{day}T12:00:00Z",
                    "total_time_minutes": 10,
                    "overall_feeling": 3,
                    "effort_rpe": 7,
                    "activity_type": "running",
                    "notes": tag,
                },
            )
            assert response.status_code == 201
            cleanup.append(f"{API}/logs/{response.json()['id']}")

        response = await client.get(
            f"{API}/training-load",
            params={"week_of": "2026-10-25", "weeks": 1, "timezone": "Europe/Prague"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        [week] = response.json()["weeks"]
        assert week["training_variability"] == {
            "status": "ready",
            "daily_mean_au": 20,
            "daily_sd_au": 31.62,
            "monotony": 0.63,
            "strain_au": 88.54,
            "daily_loads": [
                {"local_date": "2026-10-19", "load_au": 70},
                {"local_date": "2026-10-20", "load_au": 0},
                {"local_date": "2026-10-21", "load_au": 70},
                {"local_date": "2026-10-22", "load_au": 0},
                {"local_date": "2026-10-23", "load_au": 0},
                {"local_date": "2026-10-24", "load_au": 0},
                {"local_date": "2026-10-25", "load_au": 0},
            ],
        }
        current = await client.get(
            f"{API}/training-load",
            params={
                "week_of": datetime.now(UTC).date().isoformat(),
                "weeks": 1,
                "timezone": "UTC",
            },
            headers=auth_headers,
        )
        assert current.status_code == 200
        [current_week] = current.json()["weeks"]
        assert current_week["training_variability"]["status"] == "week_incomplete"
    finally:
        for url in cleanup:
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404


async def test_weekly_training_monotony_is_undefined_when_daily_load_never_varies(
    migrated_client, auth_headers
):
    client, _ = migrated_client
    tag = f"[TEST_RUN_ID:{uuid4()}]"
    cleanup = []
    try:
        for day in [
            "2026-10-26",
            "2026-10-27",
            "2026-10-28",
            "2026-10-29",
            "2026-10-30",
            "2026-10-31",
            "2026-11-01",
        ]:
            response = await client.post(
                f"{API}/logs",
                headers=auth_headers,
                json={
                    "performed_at": f"{day}T12:00:00Z",
                    "total_time_minutes": 10,
                    "overall_feeling": 3,
                    "effort_rpe": 7,
                    "activity_type": "running",
                    "notes": tag,
                },
            )
            assert response.status_code == 201
            cleanup.append(f"{API}/logs/{response.json()['id']}")

        response = await client.get(
            f"{API}/training-load",
            params={"week_of": "2026-11-01", "weeks": 1, "timezone": "UTC"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        [week] = response.json()["weeks"]
        assert week["training_variability"] == {
            "status": "zero_variation",
            "daily_mean_au": 70,
            "daily_sd_au": 0,
            "monotony": None,
            "strain_au": None,
            "daily_loads": [
                {"local_date": day, "load_au": 70}
                for day in [
                    "2026-10-26",
                    "2026-10-27",
                    "2026-10-28",
                    "2026-10-29",
                    "2026-10-30",
                    "2026-10-31",
                    "2026-11-01",
                ]
            ],
        }
    finally:
        for url in cleanup:
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404


async def test_weekly_session_effort_is_broken_down_by_activity_type(migrated_client, auth_headers):
    client, _ = migrated_client
    tag = f"[TEST_RUN_ID:{uuid4()}]"
    cleanup = []
    try:
        for day, activity_type, minutes, rating in [
            ("2024-02-05", None, 30, 6),
            ("2024-02-06", "running", 20, 5),
            ("2024-02-07", "cycling", 40, None),
        ]:
            response = await client.post(
                f"{API}/logs",
                headers=auth_headers,
                json={
                    "performed_at": f"{day}T12:00:00Z",
                    "total_time_minutes": minutes,
                    "overall_feeling": 3,
                    "effort_rpe": rating,
                    "activity_type": activity_type,
                    "notes": tag,
                },
            )
            assert response.status_code == 201
            cleanup.append(f"{API}/logs/{response.json()['id']}")

        response = await client.get(
            f"{API}/training-load",
            params={"week_of": "2024-02-11", "weeks": 1, "timezone": "UTC"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        [week] = response.json()["weeks"]
        assert week["session_effort"] == {
            "logged_sessions": 3,
            "rated_sessions": 2,
            "rated_minutes": 50,
            "load_au": 280,
        }
        assert week["session_effort_sessions"] == [
            {
                "performed_at_utc": "2024-02-05T12:00:00Z",
                "local_date": "2024-02-05",
                "activity_type": None,
                "duration_minutes": 30,
                "effort_rpe": 6,
                "load_au": 180,
            },
            {
                "performed_at_utc": "2024-02-06T12:00:00Z",
                "local_date": "2024-02-06",
                "activity_type": "running",
                "duration_minutes": 20,
                "effort_rpe": 5,
                "load_au": 100,
            },
            {
                "performed_at_utc": "2024-02-07T12:00:00Z",
                "local_date": "2024-02-07",
                "activity_type": "cycling",
                "duration_minutes": 40,
                "effort_rpe": None,
                "load_au": None,
            },
        ]
        assert week["session_effort_by_activity"] == [
            {
                "activity_type": None,
                "logged_sessions": 1,
                "rated_sessions": 1,
                "rated_minutes": 30,
                "load_au": 180,
                "workload_ratio": {
                    "status": "missing_sessions",
                    "baseline_start": "2024-01-08",
                    "baseline_mean_au": None,
                    "ratio": None,
                },
            },
            {
                "activity_type": "cycling",
                "logged_sessions": 1,
                "rated_sessions": 0,
                "rated_minutes": 0,
                "load_au": None,
                "workload_ratio": {
                    "status": "missing_sessions",
                    "baseline_start": "2024-01-08",
                    "baseline_mean_au": None,
                    "ratio": None,
                },
            },
            {
                "activity_type": "running",
                "logged_sessions": 1,
                "rated_sessions": 1,
                "rated_minutes": 20,
                "load_au": 100,
                "workload_ratio": {
                    "status": "missing_sessions",
                    "baseline_start": "2024-01-08",
                    "baseline_mean_au": None,
                    "ratio": None,
                },
            },
        ]
    finally:
        for url in reversed(cleanup):
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404
