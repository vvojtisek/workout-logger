"""POST /api/v1/ingest/health-connect: the HC Webhook app's JSON payload
(https://github.com/mcnaveen/health-connect-webhook, docs/webhook.md) mapped
onto steps, sleep and workout logs without duplicating what was logged by hand."""

URL = "/api/v1/ingest/health-connect?timezone=Europe/Prague"


def envelope(**arrays) -> dict:
    return {"timestamp": "2026-10-17T06:00:00.000Z", "app_version": "2.4.0", **arrays}


def night(start: str = "2026-10-16T21:30:00Z", end: str = "2026-10-17T05:00:00Z") -> dict:
    # 7h30 in bed: 6h50 asleep across light/deep/REM, 40 min awake.
    return {
        "session_end_time": end,
        "duration_seconds": 27_000,
        "stages": [
            {
                "stage": "4",
                "start_time": start,
                "end_time": "2026-10-17T00:00:00Z",
                "duration_seconds": 9_000,
            },
            {
                "stage": "1",
                "start_time": "2026-10-17T00:00:00Z",
                "end_time": "2026-10-17T00:40:00Z",
                "duration_seconds": 2_400,
            },
            {
                "stage": "5",
                "start_time": "2026-10-17T00:40:00Z",
                "end_time": "2026-10-17T03:00:00Z",
                "duration_seconds": 8_400,
            },
            {
                "stage": "6",
                "start_time": "2026-10-17T03:00:00Z",
                "end_time": end,
                "duration_seconds": 7_200,
            },
        ],
        "metadata": {
            "data_origin": "com.sec.android.app.shealth",
            "recording_method": "automatically_recorded",
        },
    }


def hockey(**overrides) -> dict:
    record = {
        "type": "38",
        "start_time": "2026-10-16T18:00:00Z",
        "end_time": "2026-10-16T19:15:00Z",
        "duration_seconds": 4_500,
        "metadata": {
            "data_origin": "com.sec.android.app.shealth",
            "recording_method": "actively_recorded",
        },
    }
    record.update(overrides)
    return record


async def post(client, headers, payload, url=URL):
    return await client.post(url, json=payload, headers=headers)


async def all_sleep(client, headers) -> list[dict]:
    return (await client.get("/api/v1/sleep-entries", headers=headers)).json()["items"]


async def all_logs(client, headers) -> list[dict]:
    return (await client.get("/api/v1/logs", headers=headers)).json()["items"]


async def test_requires_a_valid_timezone(client, auth_headers):
    missing = await post(client, auth_headers, envelope(), url="/api/v1/ingest/health-connect")
    bogus = await post(
        client, auth_headers, envelope(), url="/api/v1/ingest/health-connect?timezone=Mars/Base"
    )
    assert missing.status_code == 422
    assert bogus.status_code == 422


async def test_requires_the_log_scope(client):
    response = await post(client, {"X-API-Key": "nope"}, envelope())
    assert response.status_code == 401


async def test_empty_payload_and_unrelated_types_are_accepted(client, auth_headers):
    payload = envelope(heart_rate=[{"bpm": 61, "time": "2026-10-17T05:00:00Z"}])
    response = await post(client, auth_headers, payload)
    assert response.status_code == 200
    assert response.json()["sleep"]["created"] == 0


async def test_sleep_session_becomes_an_entry_with_stage_totals(client, auth_headers):
    response = await post(client, auth_headers, envelope(sleep=[night()]))
    assert response.status_code == 200
    assert response.json()["sleep"]["created"] == 1

    [entry] = await all_sleep(client, auth_headers)
    assert entry["sleep_start"].startswith("2026-10-16T21:30:00")
    assert entry["time_in_bed_seconds"] == 27_000
    assert entry["estimated_sleep_seconds"] == 24_600
    assert entry["awake_seconds"] == 2_400
    assert entry["timezone"] == "Europe/Prague"
    assert entry["source"] == "health_connect"


async def test_resending_the_same_sleep_changes_nothing(client, auth_headers):
    await post(client, auth_headers, envelope(sleep=[night()]))
    again = await post(client, auth_headers, envelope(sleep=[night()]))
    assert again.json()["sleep"] == {
        "created": 0,
        "updated": 0,
        "unchanged": 1,
        "merged": 0,
        "skipped": 0,
    }
    assert len(await all_sleep(client, auth_headers)) == 1


async def test_revised_sleep_session_updates_the_imported_entry(client, auth_headers):
    await post(client, auth_headers, envelope(sleep=[night()]))
    revised = night(start="2026-10-16T21:45:00Z")
    revised["duration_seconds"] = 26_100
    response = await post(client, auth_headers, envelope(sleep=[revised]))
    assert response.json()["sleep"]["updated"] == 1

    [entry] = await all_sleep(client, auth_headers)
    assert entry["time_in_bed_seconds"] == 26_100


async def test_sleep_overlapping_a_manual_entry_merges_into_it(client, auth_headers):
    manual = await client.post(
        "/api/v1/sleep-entries",
        json={
            "sleep_start": "2026-10-16T21:00:00Z",
            "sleep_end": "2026-10-17T05:00:00Z",
            "timezone": "Europe/Prague",
            "quality_score": 4,
            "notes": "Slept well",
        },
        headers=auth_headers,
    )
    assert manual.status_code == 201

    response = await post(client, auth_headers, envelope(sleep=[night()]))
    assert response.json()["sleep"]["merged"] == 1

    [entry] = await all_sleep(client, auth_headers)
    assert entry["id"] == manual.json()["id"]
    # The watch's measured times win; the human rating and notes stay.
    assert entry["sleep_start"].startswith("2026-10-16T21:30:00")
    assert entry["estimated_sleep_seconds"] == 24_600
    assert entry["quality_score"] == 4
    assert entry["notes"] == "Slept well"
    assert entry["source"] == "health_connect"


async def test_a_nap_does_not_merge_into_the_night(client, auth_headers):
    nap = {
        "session_end_time": "2026-10-17T13:30:00Z",
        "duration_seconds": 1_800,
        "stages": [],
    }
    response = await post(client, auth_headers, envelope(sleep=[night(), nap]))
    assert response.json()["sleep"]["created"] == 2
    [newest, _] = await all_sleep(client, auth_headers)
    assert newest["estimated_sleep_seconds"] is None


async def test_daily_steps_are_stored_per_local_day_and_updated(client, auth_headers):
    # Daily mode: one record per local day, starting at local midnight (UTC+2).
    full_day = {
        "count": 8_421,
        "start_time": "2026-10-15T22:00:00Z",
        "end_time": "2026-10-16T22:00:00Z",
    }
    first = await post(client, auth_headers, envelope(steps=[full_day]))
    assert first.json()["steps"]["created"] == 1

    later = await post(client, auth_headers, envelope(steps=[{**full_day, "count": 9_002}]))
    assert later.json()["steps"]["updated"] == 1

    exported = await client.get("/api/v1/export", headers=auth_headers)
    assert exported.status_code == 200
    days = {row["recorded_date"]: row["steps"] for row in exported.json()["step_counts"]}
    assert days == {"2026-10-16": 9_002}


async def test_a_partial_day_never_lowers_a_stored_total(client, auth_headers):
    # The oldest day in the app's rolling window is clamped, so it starts
    # mid-day and covers only part of that day's steps.
    full_day = {
        "count": 8_421,
        "start_time": "2026-10-15T22:00:00Z",
        "end_time": "2026-10-16T22:00:00Z",
    }
    partial = {
        "count": 3_000,
        "start_time": "2026-10-16T09:12:00Z",
        "end_time": "2026-10-16T22:00:00Z",
    }
    await post(client, auth_headers, envelope(steps=[full_day]))
    response = await post(client, auth_headers, envelope(steps=[partial]))
    assert response.json()["steps"]["unchanged"] == 1

    exported = (await client.get("/api/v1/export", headers=auth_headers)).json()
    assert [row["steps"] for row in exported["step_counts"]] == [8_421]


async def test_hockey_session_becomes_an_activity_log(client, auth_headers):
    response = await post(client, auth_headers, envelope(exercise=[hockey()]))
    assert response.json()["exercise"]["created"] == 1

    [log] = await all_logs(client, auth_headers)
    assert log["activity_type"] == "ice_hockey"
    assert log["total_time_minutes"] == 75
    assert log["overall_feeling"] == 3
    assert log["source"] == "health_connect"

    again = await post(client, auth_headers, envelope(exercise=[hockey()]))
    assert again.json()["exercise"]["unchanged"] == 1
    assert len(await all_logs(client, auth_headers)) == 1


async def test_exercise_types_map_to_activity_kinds(client, auth_headers):
    payload = envelope(
        exercise=[
            hockey(
                type="74",
                start_time="2026-10-10T06:00:00Z",
                end_time="2026-10-10T06:40:00Z",
                duration_seconds=2_400,
                distance_meters=1_500.0,
            ),
            hockey(
                type="8",
                start_time="2026-10-11T08:00:00Z",
                end_time="2026-10-11T10:00:00Z",
                duration_seconds=7_200,
            ),
            hockey(
                type="70",
                start_time="2026-10-12T06:00:00Z",
                end_time="2026-10-12T06:30:00Z",
                duration_seconds=1_800,
            ),
            hockey(
                type="83",
                start_time="2026-10-13T06:00:00Z",
                end_time="2026-10-13T06:30:00Z",
                duration_seconds=1_800,
            ),
        ]
    )
    await post(client, auth_headers, payload)
    logs = {log["performed_at"][:10]: log for log in await all_logs(client, auth_headers)}
    assert logs["2026-10-10"]["activity_type"] == "swimming"
    assert logs["2026-10-10"]["distance_km"] == 1.5
    assert logs["2026-10-11"]["activity_type"] == "cycling"
    assert logs["2026-10-12"]["activity_type"] is None
    assert logs["2026-10-13"]["activity_type"] == "other"


async def test_walks_and_sub_minute_sessions_are_skipped(client, auth_headers):
    payload = envelope(
        exercise=[
            hockey(type="79"),
            hockey(
                start_time="2026-10-16T18:00:00Z",
                end_time="2026-10-16T18:00:20Z",
                duration_seconds=20,
            ),
        ]
    )
    response = await post(client, auth_headers, payload)
    assert response.json()["exercise"]["skipped"] == 2
    assert await all_logs(client, auth_headers) == []


async def test_watch_hockey_merges_into_the_hand_logged_game(client, auth_headers):
    manual = await client.post(
        "/api/v1/logs",
        json={
            "performed_at": "2026-10-16T17:45:00Z",
            "total_time_minutes": 60,
            "overall_feeling": 5,
            "activity_type": "ice_hockey",
            "effort_rpe": 8,
        },
        headers=auth_headers,
    )
    assert manual.status_code == 201

    response = await post(client, auth_headers, envelope(exercise=[hockey()]))
    assert response.json()["exercise"]["merged"] == 1

    [log] = await all_logs(client, auth_headers)
    assert log["id"] == manual.json()["id"]
    assert log["overall_feeling"] == 5
    assert log["effort_rpe"] == 8
    assert log["source"] == "manual"


async def test_watch_strength_merges_into_the_in_app_workout(client, auth_headers):
    await client.post(
        "/api/v1/logs",
        json={
            "performed_at": "2026-10-16T05:30:00Z",
            "total_time_minutes": 32,
            "overall_feeling": 4,
        },
        headers=auth_headers,
    )
    watch = hockey(
        type="70",
        start_time="2026-10-16T05:00:00Z",
        end_time="2026-10-16T05:35:00Z",
        duration_seconds=2_100,
    )
    response = await post(client, auth_headers, envelope(exercise=[watch]))
    assert response.json()["exercise"]["merged"] == 1
    assert len(await all_logs(client, auth_headers)) == 1


async def test_a_bad_record_rejects_the_whole_payload(client, auth_headers):
    bad = night()
    bad["duration_seconds"] = -5
    response = await post(client, auth_headers, envelope(sleep=[bad], exercise=[hockey()]))
    assert response.status_code == 422
    assert await all_logs(client, auth_headers) == []
