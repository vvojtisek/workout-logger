STATS = "/api/v1/exercise-stats"
LOGS = "/api/v1/logs"


async def log_exercise(
    client,
    auth_headers,
    performed_at: str,
    name: str,
    weight_kg: float | None,
    reps_per_set: list[int],
) -> None:
    response = await client.post(
        LOGS,
        json={
            "performed_at": performed_at,
            "total_time_minutes": 30,
            "overall_feeling": 4,
            "exercises": [
                {
                    "exercise_name": name,
                    "sets_count": len(reps_per_set),
                    "reps_per_set": reps_per_set,
                    "weight_kg": weight_kg,
                    "rest_time_seconds": 60,
                }
            ],
        },
        headers=auth_headers,
    )
    assert response.status_code == 201


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
