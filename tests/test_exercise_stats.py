from uuid import uuid4

STATS = "/api/v1/exercise-stats"
LOGS = "/api/v1/logs"


async def log_exercise(
    client,
    auth_headers,
    performed_at: str,
    name: str,
    weight_kg: float | None,
    reps_per_set: list[int],
    *,
    weight_per_set: list[float | None] | None = None,
    rir_per_set: list[int | None] | None = None,
    notes: str | None = None,
) -> str:
    response = await client.post(
        LOGS,
        json={
            "performed_at": performed_at,
            "total_time_minutes": 30,
            "overall_feeling": 4,
            "notes": notes,
            "exercises": [
                {
                    "exercise_name": name,
                    "sets_count": len(reps_per_set),
                    "reps_per_set": reps_per_set,
                    "weight_kg": weight_kg,
                    "weight_per_set": weight_per_set,
                    "rir_per_set": rir_per_set,
                    "rest_time_seconds": 60,
                }
            ],
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_stats_for_unlogged_exercise_are_empty(client, auth_headers):
    response = await client.get(STATS, params={"name": "Goblet squat"}, headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "exercise_name": "Goblet squat",
                "sessions_count": 0,
                "last_performed_at": None,
                "last_weight_kg": None,
                "last_reps_per_set": None,
                "best_weight_kg": None,
                "best_weight_reps": None,
                "estimated_one_rep_max_kg": None,
                "trend": None,
                "recent": [],
            }
        ]
    }


async def test_stats_summarize_last_best_estimate_and_trend(client, auth_headers):
    await log_exercise(client, auth_headers, "2026-10-01T08:00:00Z", "Floor press", 30, [15, 15])
    await log_exercise(client, auth_headers, "2026-10-05T08:00:00Z", "Floor press", 32.5, [10, 8])
    await log_exercise(client, auth_headers, "2026-10-12T08:00:00Z", "floor press ", 30, [15, 12])

    response = await client.get(STATS, params={"name": "Floor press"}, headers=auth_headers)

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["exercise_name"] == "Floor press"
    assert item["sessions_count"] == 3
    assert item["last_performed_at"] == "2026-10-12T08:00:00Z"
    assert item["last_weight_kg"] == 30
    assert item["last_reps_per_set"] == [15, 12]
    # Heaviest load wins; reps break ties between equal loads.
    assert item["best_weight_kg"] == 32.5
    assert item["best_weight_reps"] == 10
    # Epley: 30 x (1 + 15/30) = 45.0 beats 32.5 x (1 + 10/30) = 43.33.
    assert item["estimated_one_rep_max_kg"] == 45.0
    # Most recent top load (30) is below the previous session's (32.5).
    assert item["trend"] == "down"


async def test_stats_use_logged_rir_as_effective_reps_for_estimates(client, auth_headers):
    await log_exercise(
        client,
        auth_headers,
        "2026-10-12T08:00:00Z",
        "RIR-adjusted press",
        60,
        [5],
        rir_per_set=[3],
    )

    epley = await client.get(STATS, params={"name": "RIR-adjusted press"}, headers=auth_headers)
    assert epley.status_code == 200
    item = epley.json()["items"][0]
    assert item["estimated_one_rep_max_kg"] == 76.0
    assert item["recent"][0] == {
        "performed_at": "2026-10-12T08:00:00Z",
        "weight_kg": 60,
        "top_reps": 5,
        "estimated_one_rep_max_kg": 76.0,
    }

    brzycki = await client.get(
        STATS,
        params={"name": "RIR-adjusted press", "formula": "brzycki"},
        headers=auth_headers,
    )
    assert brzycki.json()["items"][0]["estimated_one_rep_max_kg"] == 74.5


async def test_stats_trend_up_and_flat(client, auth_headers):
    await log_exercise(client, auth_headers, "2026-10-01T08:00:00Z", "Row", 15, [12, 12])
    await log_exercise(client, auth_headers, "2026-10-08T08:00:00Z", "Row", 17.5, [10, 10])
    await log_exercise(client, auth_headers, "2026-10-01T09:00:00Z", "RDL", 45, [10, 10])
    await log_exercise(client, auth_headers, "2026-10-08T09:00:00Z", "RDL", 45, [10, 10])

    response = await client.get(
        STATS, params=[("name", "Row"), ("name", "RDL")], headers=auth_headers
    )

    assert response.status_code == 200
    by_name = {item["exercise_name"]: item for item in response.json()["items"]}
    assert by_name["Row"]["trend"] == "up"
    assert by_name["RDL"]["trend"] == "flat"


async def test_stats_without_load_have_no_weight_figures(client, auth_headers):
    await log_exercise(client, auth_headers, "2026-10-12T08:00:00Z", "Dead bug", None, [6, 10])

    response = await client.get(STATS, params={"name": "Dead bug"}, headers=auth_headers)

    item = response.json()["items"][0]
    assert item["sessions_count"] == 1
    assert item["last_reps_per_set"] == [6, 10]
    assert item["best_weight_kg"] is None
    assert item["estimated_one_rep_max_kg"] is None
    assert item["trend"] is None


async def test_stats_require_at_least_one_name(client, auth_headers):
    response = await client.get(STATS, headers=auth_headers)

    assert response.status_code == 422


async def test_stats_reject_too_many_names(client, auth_headers):
    response = await client.get(
        STATS, params=[("name", f"Exercise {index}") for index in range(51)], headers=auth_headers
    )

    assert response.status_code == 422


async def test_stats_list_recent_sessions_oldest_first_for_charts(client, auth_headers):
    await log_exercise(client, auth_headers, "2026-10-01T08:00:00Z", "Floor press", 30, [15, 15])
    await log_exercise(client, auth_headers, "2026-10-05T08:00:00Z", "Floor press", 32.5, [10, 8])
    await log_exercise(client, auth_headers, "2026-10-08T08:00:00Z", "Floor press", None, [20])

    response = await client.get(STATS, params={"name": "Floor press"}, headers=auth_headers)

    assert response.json()["items"][0]["recent"] == [
        {
            "performed_at": "2026-10-01T08:00:00Z",
            "weight_kg": 30,
            "top_reps": 15,
            "estimated_one_rep_max_kg": 45.0,
        },
        {
            "performed_at": "2026-10-05T08:00:00Z",
            "weight_kg": 32.5,
            "top_reps": 10,
            "estimated_one_rep_max_kg": 43.5,
        },
        # A session without load still counts; it just has no estimate.
        {
            "performed_at": "2026-10-08T08:00:00Z",
            "weight_kg": None,
            "top_reps": 20,
            "estimated_one_rep_max_kg": None,
        },
    ]


async def test_stats_recent_keeps_the_last_twelve_sessions(client, auth_headers):
    for day in range(1, 16):
        await log_exercise(
            client, auth_headers, f"2026-09-{day:02d}T08:00:00Z", "Row", 40 + day, [8]
        )

    response = await client.get(STATS, params={"name": "Row"}, headers=auth_headers)

    recent = response.json()["items"][0]["recent"]
    assert len(recent) == 12
    assert recent[0]["performed_at"] == "2026-09-04T08:00:00Z"
    assert recent[-1]["weight_kg"] == 55


async def test_stats_pair_each_sets_weight_and_reps_on_migrated_database(
    migrated_client, app_engine, auth_headers
):
    client, _ = migrated_client
    notes = f"[TEST_RUN_ID:{uuid4()}]"
    exercises = [
        ("Squat", 50, [3, 12], [100, 50]),
        ("Bench", 90, [1, 10], [100, 90]),
        ("Pull-up", 80, [20, 5, 15], [None, 80, None]),
        ("Row", 50, [8, 10], None),
        ("Push-up", None, [12, 10], [None, None]),
    ]
    log_ids = []
    try:
        for name, working_weight, reps, weights in exercises:
            log_ids.append(
                await log_exercise(
                    client,
                    auth_headers,
                    "2026-10-08T08:00:00Z",
                    name,
                    working_weight,
                    reps,
                    weight_per_set=weights,
                    notes=notes,
                )
            )

        response = await client.get(
            STATS, params=[("name", name) for name, *_ in exercises], headers=auth_headers
        )

        assert response.status_code == 200
        items = {item["exercise_name"]: item for item in response.json()["items"]}
        assert items["Squat"]["last_weight_kg"] == 50
        assert items["Squat"]["last_reps_per_set"] == [3, 12]
        expected = {
            # (heaviest load, reps at heaviest load, best e1RM, its load and reps)
            "Squat": (100, 3, 110, 100, 3),
            "Bench": (100, 1, 120, 90, 10),
            "Pull-up": (80, 5, 93.5, 80, 5),
            "Row": (50, 10, 66.5, 50, 10),
            "Push-up": (None, None, None, None, 12),
        }
        for name, (
            best_weight,
            best_weight_reps,
            estimate,
            point_weight,
            point_reps,
        ) in expected.items():
            item = items[name]
            assert item["best_weight_kg"] == best_weight, name
            assert item["best_weight_reps"] == best_weight_reps, name
            assert item["estimated_one_rep_max_kg"] == estimate, name
            assert item["recent"] == [
                {
                    "performed_at": "2026-10-08T08:00:00Z",
                    "weight_kg": point_weight,
                    "top_reps": point_reps,
                    "estimated_one_rep_max_kg": estimate,
                }
            ], name
    finally:
        for log_id in log_ids:
            url = f"{LOGS}/{log_id}"
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404


async def test_stats_date_window_limits_all_metrics_on_migrated_database(
    migrated_client, app_engine, auth_headers
):
    client, _ = migrated_client
    notes = f"[TEST_RUN_ID:{uuid4()}]"
    log_ids = []
    try:
        for performed_at, weight in [
            ("2026-10-01T07:59:59Z", 110),
            ("2026-10-01T08:00:00Z", 100),
            ("2026-10-05T08:00:00Z", 90),
            ("2026-11-01T08:00:00Z", 120),
        ]:
            log_ids.append(
                await log_exercise(
                    client, auth_headers, performed_at, "Row", weight, [6], notes=notes
                )
            )

        response = await client.get(
            STATS,
            params={
                "name": "Row",
                "formula": "lombardi",
                "date_from": "2026-10-01T10:00:00+02:00",
                "date_to": "2026-11-01T09:00:00+01:00",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["sessions_count"] == 2
        assert item["last_weight_kg"] == 90
        assert item["best_weight_kg"] == 100
        assert item["estimated_one_rep_max_kg"] == 119.5
        assert item["trend"] == "down"
        assert [point["performed_at"] for point in item["recent"]] == [
            "2026-10-01T08:00:00Z",
            "2026-10-05T08:00:00Z",
        ]

        all_time = await client.get(STATS, params={"name": "Row"}, headers=auth_headers)
        assert all_time.json()["items"][0]["sessions_count"] == 4
        assert all_time.json()["items"][0]["best_weight_kg"] == 120

        for date_range in [
            {"date_from": "2026-11-01T08:00:00Z"},
            {"date_to": "2026-11-01T08:00:00Z"},
            {"date_from": "2026-11-01T08:00:00Z", "date_to": "2026-11-01T08:00:00Z"},
            {"date_from": "2026-11-01T08:00:00Z", "date_to": "2026-10-01T08:00:00Z"},
            {"date_from": "2026-10-01T08:00:00", "date_to": "2026-11-01T08:00:00Z"},
        ]:
            invalid = await client.get(
                STATS, params={"name": "Row", **date_range}, headers=auth_headers
            )
            assert invalid.status_code == 422, date_range
    finally:
        for log_id in log_ids:
            url = f"{LOGS}/{log_id}"
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404


async def test_stats_use_selected_formula_and_bound_alternate_models(
    migrated_client, app_engine, auth_headers
):
    client, _ = migrated_client
    notes = f"[TEST_RUN_ID:{uuid4()}]"
    names = [("name", name) for name in ("Bench", "Press", "Row")]
    log_ids = []
    try:
        for name, weight, reps, per_set in [
            ("Bench", 150, [8, 11], [100, 150]),
            ("Press", 100, [10], None),
            ("Row", 50, [40], None),
        ]:
            log_ids.append(
                await log_exercise(
                    client,
                    auth_headers,
                    "2026-10-08T08:00:00Z",
                    name,
                    weight,
                    reps,
                    weight_per_set=per_set,
                    notes=notes,
                )
            )

        default = await client.get(STATS, params=names, headers=auth_headers)
        assert default.status_code == 200
        explicit = await client.get(
            STATS, params=[*names, ("formula", "epley")], headers=auth_headers
        )
        assert explicit.status_code == 200
        assert explicit.json() == default.json()
        assert [item["estimated_one_rep_max_kg"] for item in default.json()["items"]] == [
            205,
            133.5,
            116.5,
        ]

        for formula, bench_estimate, press_estimate in [
            ("brzycki", 124, 133.5),
            ("lombardi", 123, 126),
            ("wathen", 127.5, 134.5),
        ]:
            response = await client.get(
                STATS, params=[*names, ("formula", formula)], headers=auth_headers
            )
            assert response.status_code == 200
            bench, press, row = response.json()["items"]
            assert bench["best_weight_kg"] == 150
            assert bench["best_weight_reps"] == 11
            assert bench["estimated_one_rep_max_kg"] == bench_estimate, formula
            assert bench["recent"][0] == {
                "performed_at": "2026-10-08T08:00:00Z",
                "weight_kg": 100,
                "top_reps": 8,
                "estimated_one_rep_max_kg": bench_estimate,
            }
            assert press["estimated_one_rep_max_kg"] == press_estimate
            assert row["best_weight_kg"] == 50
            assert row["estimated_one_rep_max_kg"] is None
            assert row["recent"][0]["estimated_one_rep_max_kg"] is None

        invalid = await client.get(
            STATS, params=[*names, ("formula", "unknown")], headers=auth_headers
        )
        assert invalid.status_code == 422
    finally:
        for log_id in log_ids:
            url = f"{LOGS}/{log_id}"
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404
