"""Cardio and recovery logging: the new workout-log fields over REST and MCP,
the one-tap /coach/log path (recovery links, Health Connect merge), and the
readiness rules that keep recovery out of training. Runs the real app against
a real temporary SQLite database."""

from datetime import UTC, datetime, timedelta

from tests.conftest import mint_mcp_oauth_token
from tests.test_mcp_server import mcp_client

LOGS = "/api/v1/logs"
COACH_LOG = "/api/v1/coach/log"
HC_URL = "/api/v1/ingest/health-connect?timezone=Europe/Prague"


def cardio(**overrides) -> dict:
    payload = {
        "performed_at": "2026-11-14T18:00:00Z",
        "total_time_minutes": 75,
        "overall_feeling": 4,
        "activity_type": "ice_hockey",
        "effort_level": 4,
        "feel_before": 4,
        "feel_after": 2,
    }
    payload.update(overrides)
    return payload


async def create(client, auth_headers, payload: dict) -> dict:
    response = await client.post(LOGS, json=payload, headers=auth_headers)
    assert response.status_code == 201, response.text
    return response.json()


async def test_cardio_log_stores_effort_level_and_feel_and_derives_rpe(client, auth_headers):
    body = await create(client, auth_headers, cardio())

    assert body["activity_category"] == "cardio"
    assert body["effort_level"] == 4
    assert body["effort_rpe"] == 7  # level 4 -> CR-10 7, so training load still counts it
    assert body["feel_before"] == 4
    assert body["feel_after"] == 2
    assert body["cycles"] is None

    explicit = await create(client, auth_headers, cardio(effort_level=2, effort_rpe=4))
    assert explicit["effort_rpe"] == 4


async def test_strength_logs_read_as_strength(client, auth_headers):
    body = await create(
        client,
        auth_headers,
        {
            "performed_at": "2026-11-14T07:00:00Z",
            "total_time_minutes": 40,
            "overall_feeling": 4,
            "exercises": [{"exercise_name": "Goblet squat", "sets_count": 1, "reps_per_set": [8]}],
        },
    )
    assert body["activity_category"] == "strength"
    assert body["effort_level"] is None


async def test_recovery_log_keeps_cycles_and_adds_no_training_load(client, auth_headers):
    swim = await create(client, auth_headers, cardio(activity_type="swimming", effort_level=2))
    sauna = await create(
        client,
        auth_headers,
        {
            "performed_at": "2026-11-14T19:20:00Z",
            "total_time_minutes": 45,
            "overall_feeling": 4,
            "activity_type": "sauna",
            "effort_level": 2,
            "cycles": 3,
            "cycle_minutes": 12,
            "linked_log_id": swim["id"],
        },
    )

    assert sauna["activity_category"] == "recovery"
    assert sauna["effort_rpe"] is None
    assert sauna["cycles"] == 3
    assert sauna["sauna_rounds"] == 3  # the legacy field follows
    assert sauna["cycle_minutes"] == 12
    assert sauna["linked_log_id"] == swim["id"]

    for kind in ("meditation", "stretching", "cold_plunge"):
        body = await create(
            client,
            auth_headers,
            {
                "performed_at": "2026-11-14T21:00:00Z",
                "total_time_minutes": 10,
                "overall_feeling": 4,
                "activity_type": kind,
            },
        )
        assert body["activity_category"] == "recovery"

    recovery = await client.get(f"{LOGS}?category=recovery", headers=auth_headers)
    assert {item["activity_type"] for item in recovery.json()["items"]} == {
        "sauna",
        "meditation",
        "stretching",
        "cold_plunge",
    }
    cardio_only = await client.get(f"{LOGS}?category=cardio", headers=auth_headers)
    assert [item["id"] for item in cardio_only.json()["items"]] == [swim["id"]]


async def test_out_of_range_values_are_rejected(client, auth_headers):
    for field, value in (
        ("effort_level", 0),
        ("effort_level", 6),
        ("feel_before", 6),
        ("feel_after", 0),
        ("cycles", 0),
        ("cycles", 21),
        ("cycle_minutes", 0),
        ("activity_type", "quidditch"),
    ):
        response = await client.post(LOGS, json=cardio(**{field: value}), headers=auth_headers)
        assert response.status_code == 422, (field, value)


async def test_linked_log_must_exist_and_clears_when_its_target_goes(client, auth_headers):
    missing = await client.post(
        LOGS,
        json=cardio(activity_type="sauna", linked_log_id="00000000-0000-0000-0000-000000000000"),
        headers=auth_headers,
    )
    assert missing.status_code == 404
    assert missing.json()["code"] == "LINKED_LOG_NOT_FOUND"

    swim = await create(client, auth_headers, cardio(activity_type="swimming"))
    sauna = await create(
        client, auth_headers, cardio(activity_type="sauna", cycles=2, linked_log_id=swim["id"])
    )
    self_link = await client.patch(
        f"{LOGS}/{sauna['id']}", json={"linked_log_id": sauna["id"]}, headers=auth_headers
    )
    assert self_link.status_code == 422

    assert (await client.delete(f"{LOGS}/{swim['id']}", headers=auth_headers)).status_code == 204
    kept = await client.get(f"{LOGS}/{sauna['id']}", headers=auth_headers)
    assert kept.status_code == 200
    assert kept.json()["linked_log_id"] is None


async def test_patch_moves_a_derived_rpe_with_the_effort_level(client, auth_headers):
    log = await create(client, auth_headers, cardio(effort_level=4))
    assert log["effort_rpe"] == 7

    patched = await client.patch(
        f"{LOGS}/{log['id']}", json={"effort_level": 2}, headers=auth_headers
    )
    assert patched.status_code == 200
    assert patched.json()["effort_level"] == 2
    assert patched.json()["effort_rpe"] == 3

    # An RPE someone typed is theirs and stays.
    typed = await create(client, auth_headers, cardio(effort_level=4, effort_rpe=8))
    patched = await client.patch(
        f"{LOGS}/{typed['id']}", json={"effort_level": 3}, headers=auth_headers
    )
    assert patched.json()["effort_rpe"] == 8

    # Older clients replacing the whole log keep working without the new fields.
    replaced = await client.put(
        f"{LOGS}/{log['id']}",
        json={
            "performed_at": "2026-11-14T18:00:00Z",
            "total_time_minutes": 60,
            "overall_feeling": 3,
            "activity_type": "ice_hockey",
            "effort_rpe": 6,
        },
        headers=auth_headers,
    )
    assert replaced.status_code == 200
    assert replaced.json()["effort_rpe"] == 6
    assert replaced.json()["effort_level"] is None


async def test_one_tap_sauna_links_to_the_swim_before_it(client, auth_headers):
    swim_at = datetime.now(UTC) - timedelta(hours=1)
    swim = await client.post(
        COACH_LOG,
        json={"activity": {"type": "swimming", "performed_at": swim_at.isoformat()}},
        headers=auth_headers,
    )
    swim_id = swim.json()["workout_log"]["id"]

    tapped = await client.post(
        COACH_LOG, json={"activity": {"type": "sauna", "cycles": 3}}, headers=auth_headers
    )
    assert tapped.status_code == 201, tapped.text
    sauna = tapped.json()["workout_log"]
    assert sauna["activity_type"] == "sauna"
    assert sauna["activity_category"] == "recovery"
    assert sauna["cycles"] == 3
    assert sauna["sauna_rounds"] == 3
    assert sauna["total_time_minutes"] == 45
    assert sauna["linked_log_id"] == swim_id
    assert tapped.json()["merged_into_existing"] is False

    stored = await client.get(f"{LOGS}/{sauna['id']}", headers=auth_headers)
    assert stored.json()["linked_log_id"] == swim_id

    unlinked = await client.post(
        COACH_LOG,
        json={"activity": {"type": "meditation", "link_to_previous": False}},
        headers=auth_headers,
    )
    assert unlinked.json()["workout_log"]["linked_log_id"] is None
    assert unlinked.json()["workout_log"]["total_time_minutes"] == 15


async def test_cycles_and_minutes_per_cycle_give_the_duration(client, auth_headers):
    response = await client.post(
        COACH_LOG,
        json={"activity": {"type": "cold_plunge", "cycles": 3, "cycle_minutes": 2}},
        headers=auth_headers,
    )
    log = response.json()["workout_log"]
    assert log["total_time_minutes"] == 6
    assert log["cycles"] == 3
    assert log["sauna_rounds"] is None


async def test_rated_hockey_fills_the_watch_session_instead_of_duplicating(client, auth_headers):
    watch = {
        "type": "38",
        "start_time": "2026-11-14T18:02:00Z",
        "end_time": "2026-11-14T19:20:00Z",
        "duration_seconds": 4_680,
        "metadata": {"data_origin": "com.sec.android.app.shealth"},
    }
    synced = await client.post(
        HC_URL,
        json={"timestamp": "2026-11-14T20:00:00Z", "app_version": "2.4.0", "exercise": [watch]},
        headers=auth_headers,
    )
    assert synced.json()["exercise"]["created"] == 1

    rated = await client.post(
        COACH_LOG,
        json={
            "activity": {
                "type": "ice_hockey",
                "performed_at": "2026-11-14T18:00:00Z",
                "duration_minutes": 75,
                "effort_level": 5,
                "feel_before": 4,
                "feel_after": 2,
            }
        },
        headers=auth_headers,
    )
    assert rated.status_code == 201, rated.text
    assert rated.json()["merged_into_existing"] is True
    log = rated.json()["workout_log"]
    assert log["source"] == "health_connect"
    assert log["total_time_minutes"] == 78  # the watch's measurement stays
    assert log["effort_level"] == 5
    assert log["effort_rpe"] == 9
    assert log["feel_after"] == 2
    assert log["overall_feeling"] == 2

    listed = (await client.get(f"{LOGS}?category=cardio", headers=auth_headers)).json()
    assert listed["total"] == 1

    # Once rated, a second hockey game the same evening is its own entry.
    again = await client.post(
        COACH_LOG,
        json={"activity": {"type": "ice_hockey", "performed_at": "2026-11-14T20:30:00Z"}},
        headers=auth_headers,
    )
    assert again.json()["merged_into_existing"] is False


async def test_recovery_alone_is_not_training_for_readiness(client, auth_headers):
    yesterday = datetime.now(UTC) - timedelta(days=1)
    await client.post(
        COACH_LOG,
        json={"activity": {"type": "meditation", "performed_at": yesterday.isoformat()}},
        headers=auth_headers,
    )
    check_in = await client.post(
        COACH_LOG,
        json={"readiness": {"soreness": 2, "fatigue": 2, "sleep_quality": 8}},
        headers=auth_headers,
    )
    assert check_in.status_code == 201, check_in.text
    assert check_in.json()["readiness_log"]["prior_day_strain"] == "none"


async def test_mcp_logs_and_edits_the_new_fields(client, auth_headers):
    async with mcp_client(mint_mcp_oauth_token()) as agent:
        created = await agent.call_tool(
            "log_workout",
            {
                "performed_at": "2026-11-10T17:00:00Z",
                "total_time_minutes": 40,
                "overall_feeling": 4,
                "activity_type": "swimming",
                "effort_level": 2,
                "feel_before": 3,
                "feel_after": 5,
            },
        )
        swim_id = created.data["id"]
        assert created.data["effort_rpe"] == 3
        assert created.data["activity_category"] == "cardio"

        sauna = await agent.call_tool(
            "log_workout",
            {
                "performed_at": "2026-11-10T17:45:00Z",
                "total_time_minutes": 45,
                "overall_feeling": 4,
                "activity_type": "sauna",
                "cycles": 3,
                "linked_log_id": swim_id,
            },
        )
        assert sauna.data["linked_log_id"] == swim_id

        updated = await agent.call_tool(
            "update_workout", {"workout_log_id": swim_id, "effort_level": 3}
        )
        assert updated.data["effort_level"] == 3
        assert updated.data["effort_rpe"] == 5
        assert updated.data["feel_after"] == 5

        tapped = await agent.call_tool(
            "log_readiness_and_activity",
            {"activity": {"type": "stretching", "performed_at": "2026-11-10T18:40:00Z"}},
        )
        assert tapped.data["workout_log"]["activity_type"] == "stretching"
        assert tapped.data["workout_log"]["linked_log_id"] == swim_id

    stored = await client.get(f"{LOGS}/{swim_id}", headers=auth_headers)
    assert stored.json()["feel_before"] == 3


async def test_editing_sauna_rounds_or_cycles_keeps_both_in_step(client, auth_headers):
    sauna = await create(
        client,
        auth_headers,
        {
            "performed_at": "2026-11-14T19:00:00Z",
            "total_time_minutes": 45,
            "overall_feeling": 4,
            "activity_type": "sauna",
            "cycles": 3,
        },
    )
    # The history editor sends sauna_rounds.
    edited = await client.patch(
        f"{LOGS}/{sauna['id']}", json={"sauna_rounds": 2}, headers=auth_headers
    )
    assert (edited.json()["sauna_rounds"], edited.json()["cycles"]) == (2, 2)
    # An agent may send cycles.
    edited = await client.patch(f"{LOGS}/{sauna['id']}", json={"cycles": 4}, headers=auth_headers)
    assert (edited.json()["sauna_rounds"], edited.json()["cycles"]) == (4, 4)
