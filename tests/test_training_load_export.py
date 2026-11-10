import csv
from io import StringIO
from uuid import uuid4

LOGS = "/api/v1/logs"
EXPORT = "/api/v1/training-load/export"


async def test_training_load_export_preserves_logged_values_in_selected_local_weeks(
    migrated_client, app_engine, auth_headers
):
    client, _ = migrated_client
    tag = f"[TEST_RUN_ID:{uuid4()}]"
    ids = []
    try:
        for payload in [
            {"performed_at": "2026-10-18T21:59:59Z", "activity_type": "cycling"},
            {
                "performed_at": "2026-10-18T22:00:00Z",
                "effort_rpe": 7,
                "exercises": [
                    {
                        "exercise_name": '=2+2, "Činkový bench"',
                        "sets_count": 3,
                        "reps_per_set": [8, 6, 4],
                        "weight_per_set": [60, None, 0],
                        "rir_per_set": [0, None, 1],
                    },
                    {
                        "exercise_name": "\u200b +Legacy row",
                        "sets_count": 2,
                        "reps_per_set": [12, 9],
                        "weight_kg": 20,
                    },
                ],
            },
            {"performed_at": "2026-10-21T12:00:00Z", "activity_type": "running", "effort_rpe": 4},
            {"performed_at": "2026-10-21T12:00:00Z", "activity_type": "swimming", "effort_rpe": 4},
            {"performed_at": "2026-10-25T23:00:00Z", "activity_type": "cycling"},
        ]:
            logged = await client.post(
                LOGS,
                headers=auth_headers,
                json={"total_time_minutes": 30, "overall_feeling": 3, "notes": tag, **payload},
            )
            assert logged.status_code == 201
            ids.append(logged.json()["id"])

        response = await client.get(
            EXPORT,
            params={"week_of": "2026-10-25", "weeks": 1, "timezone": "Europe/Prague"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert response.headers["content-disposition"] == (
            'attachment; filename="training-load-2026-10-19-through-2026-10-25.csv"'
        )
        rows = list(csv.DictReader(StringIO(response.content.decode("utf-8-sig"))))
        assert [row["record_type"] for row in rows] == [
            "session",
            *["set"] * 5,
            "session",
            "session",
        ]
        assert [row["workout_id"] for row in rows] == [*[ids[1]] * 6, *sorted(ids[2:4])]
        assert all(row["week_start"] == "2026-10-19" for row in rows)
        assert all(row["timezone"] == "Europe/Prague" for row in rows)
        assert rows[0]["performed_at_utc"] == "2026-10-18T22:00:00Z"
        assert rows[0]["local_date"] == "2026-10-19"
        assert [row["duration_minutes"] for row in rows] == ["30", *[""] * 5, "30", "30"]
        assert [row["session_rpe"] for row in rows] == ["7", *[""] * 5, "4", "4"]
        assert rows[1]["exercise_name"] == '\'=2+2, "Činkový bench"'
        assert rows[4]["exercise_name"] == "'\u200b +Legacy row"
        assert [row["exercise_number"] for row in rows[1:6]] == ["1", "1", "1", "2", "2"]
        assert [row["set_number"] for row in rows[1:6]] == ["1", "2", "3", "1", "2"]
        assert [row["weight_kg"] for row in rows[1:6]] == ["60.0", "", "0.0", "20.0", "20.0"]
        assert [row["reps"] for row in rows[1:6]] == ["8", "6", "4", "12", "9"]
        assert [row["rir"] for row in rows[1:6]] == ["0", "", "1", "", ""]
        assert {row["activity_type"] for row in rows[-2:]} == {"running", "swimming"}
    finally:
        for log_id in ids:
            url = f"{LOGS}/{log_id}"
            assert (await client.delete(url, headers=auth_headers)).status_code == 204
            assert (await client.get(url, headers=auth_headers)).status_code == 404
