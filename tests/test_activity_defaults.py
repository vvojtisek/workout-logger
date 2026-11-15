"""The predictive prefill engine behind GET /api/v1/activities/defaults.

Seeds eight weeks of a steady routine (Tuesday and Thursday swims at 18:00
each followed by three sauna cycles, Sunday hockey at 19:30) through the real
API and checks the defaults reproduce it exactly for each weekday."""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.activity_kinds import level_to_rpe, rpe_to_level, season_of

LOGS = "/api/v1/logs"
DEFAULTS = "/api/v1/activities/defaults"
ZONE = ZoneInfo("Europe/Prague")
TZ = "Europe/Prague"
# A Tuesday in winter; the routine runs for the eight weeks before it.
TARGET_TUESDAY = date(2026, 12, 15)


def at(day: date, hour: int, minute: int) -> str:
    return datetime.combine(day, time(hour, minute), tzinfo=ZONE).isoformat()


async def seed_routine(client, auth_headers, weeks: int = 8) -> None:
    for week in range(1, weeks + 1):
        tuesday = TARGET_TUESDAY - timedelta(weeks=week)
        for day in (tuesday, tuesday + timedelta(days=2)):
            # Starts drift a few minutes; the 15-minute slot stays 18:00.
            swim = await client.post(
                LOGS,
                json={
                    "performed_at": at(day, 17, 55 + week % 3),
                    "total_time_minutes": 30,
                    "overall_feeling": 4,
                    "activity_type": "swimming",
                    "effort_level": 2,
                },
                headers=auth_headers,
            )
            assert swim.status_code == 201, swim.text
            sauna = await client.post(
                LOGS,
                json={
                    "performed_at": at(day, 18, 35),
                    "total_time_minutes": 45,
                    "overall_feeling": 5,
                    "activity_type": "sauna",
                    "cycles": 3,
                    "linked_log_id": swim.json()["id"],
                },
                headers=auth_headers,
            )
            assert sauna.status_code == 201, sauna.text
        sunday = tuesday - timedelta(days=2)
        hockey = await client.post(
            LOGS,
            json={
                "performed_at": at(sunday, 19, 30),
                "total_time_minutes": 75,
                "overall_feeling": 3,
                "activity_type": "ice_hockey",
                "effort_level": 4,
            },
            headers=auth_headers,
        )
        assert hockey.status_code == 201, hockey.text


async def defaults(client, auth_headers, **params) -> dict:
    query = {"timezone": TZ, **params}
    response = await client.get(DEFAULTS, params=query, headers=auth_headers)
    assert response.status_code == 200, response.text
    return response.json()


# On the Thursday the eighth week's Tuesday swim has left the window.
@pytest.mark.parametrize(
    ("day", "swims_in_window"),
    [(TARGET_TUESDAY, 16), (TARGET_TUESDAY + timedelta(days=2), 15)],
)
async def test_swim_days_predict_the_swim_and_the_sauna_after_it(
    client, auth_headers, day, swims_in_window
):
    await seed_routine(client, auth_headers)

    cardio = await defaults(client, auth_headers, date=day.isoformat(), category="cardio")
    assert cardio["day_of_week"] == day.weekday()
    assert cardio["season"] == "winter"
    assert cardio["suggested"] == {
        "activity_type": "swimming",
        "activity_name": None,
        "start_time": "18:00",
        "started_at": datetime.combine(day, time(18, 0), tzinfo=ZONE)
        .astimezone(ZoneInfo("UTC"))
        .isoformat()
        .replace("+00:00", "Z"),
        "duration_minutes": 30,
        "effort_level": 2,
        "cycles": None,
        "cycle_minutes": None,
        "observations": swims_in_window,
        "same_weekday_observations": 8,
        "basis": "same_weekday",
    }
    assert cardio["time_slots"][0] == "18:00"
    assert [item["activity_type"] for item in cardio["ranked"]][:2] == ["swimming", "ice_hockey"]

    recovery = await defaults(client, auth_headers, date=day.isoformat(), category="recovery")
    sauna = recovery["suggested"]
    assert sauna["activity_type"] == "sauna"
    assert sauna["start_time"] == "18:30"
    assert sauna["duration_minutes"] == 45
    assert sauna["cycles"] == 3
    assert sauna["effort_level"] is None
    assert recovery["presets"][0] == {
        "label": "Sauna · 3 cycles",
        "activity_type": "sauna",
        "duration_minutes": 45,
        "cycles": 3,
        "cycle_minutes": None,
        "times_logged": swims_in_window,
    }
    assert len(recovery["presets"]) == 4


async def test_sunday_predicts_hockey(client, auth_headers):
    await seed_routine(client, auth_headers)
    sunday = TARGET_TUESDAY + timedelta(days=5)

    result = await defaults(client, auth_headers, date=sunday.isoformat())

    suggested = result["suggested"]
    assert suggested["activity_type"] == "ice_hockey"
    assert suggested["start_time"] == "19:30"
    assert suggested["duration_minutes"] == 75
    assert suggested["effort_level"] == 4
    assert suggested["basis"] == "same_weekday"
    assert result["time_slots"] == ["19:30"]


async def test_day_of_week_alone_picks_the_latest_such_day(client, auth_headers):
    response = await client.get(
        DEFAULTS, params={"day_of_week": 6, "timezone": TZ}, headers=auth_headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body["day_of_week"] == 6
    assert date.fromisoformat(body["date"]).weekday() == 6
    assert date.fromisoformat(body["date"]) <= datetime.now(ZONE).date()


async def test_a_weekday_with_no_routine_falls_back_to_the_whole_window(client, auth_headers):
    await seed_routine(client, auth_headers)
    monday = TARGET_TUESDAY - timedelta(days=1)

    result = await defaults(client, auth_headers, date=monday.isoformat())

    assert result["suggested"]["activity_type"] == "swimming"
    assert result["suggested"]["basis"] == "recent"
    assert result["time_slots"] == []


async def test_no_history_uses_the_season(client, auth_headers):
    winter = await defaults(client, auth_headers, date="2026-01-12")
    assert winter["history_entries"] == 0
    assert winter["suggested"]["activity_type"] == "ice_hockey"
    assert winter["suggested"]["basis"] == "default"
    assert winter["suggested"]["start_time"] is None
    ranked = {item["activity_type"]: item for item in winter["ranked"]}
    assert [item["activity_type"] for item in winter["ranked"]][:2] == ["ice_hockey", "swimming"]
    assert ranked["swimming"]["effort_level"] == 2  # winter swims default to relaxed

    summer = await defaults(client, auth_headers, date="2026-07-13")
    assert [item["activity_type"] for item in summer["ranked"]][:3] == [
        "cycling",
        "hiking",
        "swimming",
    ]
    assert {item["activity_type"]: item for item in summer["ranked"]}["swimming"][
        "effort_level"
    ] == 3

    recovery = await defaults(client, auth_headers, date="2026-07-13", category="recovery")
    assert recovery["suggested"]["activity_type"] == "sauna"
    assert recovery["suggested"]["cycles"] == 3
    assert [preset["label"] for preset in recovery["presets"]] == [
        "Sauna · 3 cycles",
        "Sauna · 2 cycles",
        "Meditation · 15 min",
        "Stretching · 15 min",
    ]


async def test_a_swim_saved_with_sauna_rounds_counts_as_a_sauna(client, auth_headers):
    monday = date(2026, 11, 2)
    for week in range(1, 5):
        response = await client.post(
            "/api/v1/coach/log",
            json={
                "activity": {
                    "type": "swim_sauna",
                    "performed_at": at(monday + timedelta(weeks=week - 1), 7, 0),
                    "sauna_rounds": 2,
                }
            },
            headers=auth_headers,
        )
        assert response.status_code == 201, response.text

    result = await defaults(
        client, auth_headers, date=(monday + timedelta(weeks=4)).isoformat(), category="recovery"
    )

    sauna = result["suggested"]
    assert sauna["activity_type"] == "sauna"
    assert sauna["cycles"] == 2
    assert sauna["start_time"] == "07:30"  # right after the 30-minute swim
    assert sauna["duration_minutes"] == 30
    assert result["presets"][0]["label"] == "Sauna · 2 cycles"


async def test_recovery_lists_the_days_sessions_to_link(client, auth_headers):
    day = date(2026, 11, 20)
    swim = await client.post(
        LOGS,
        json={
            "performed_at": at(day, 18, 0),
            "total_time_minutes": 30,
            "overall_feeling": 4,
            "activity_type": "swimming",
        },
        headers=auth_headers,
    )
    await client.post(
        LOGS,
        json={
            "performed_at": at(day, 18, 40),
            "total_time_minutes": 45,
            "overall_feeling": 4,
            "activity_type": "sauna",
        },
        headers=auth_headers,
    )

    result = await defaults(client, auth_headers, date=day.isoformat(), category="recovery")

    assert [item["id"] for item in result["link_candidates"]] == [swim.json()["id"]]
    assert result["link_candidates"][0]["activity_type"] == "swimming"


async def test_bad_parameters_are_rejected(client, auth_headers):
    bad_zone = await client.get(DEFAULTS, params={"timezone": "Mars/Base"}, headers=auth_headers)
    assert bad_zone.status_code == 422

    mismatch = await client.get(
        DEFAULTS,
        params={"timezone": TZ, "date": TARGET_TUESDAY.isoformat(), "day_of_week": 3},
        headers=auth_headers,
    )
    assert mismatch.status_code == 422

    for params in ({"weeks": 3}, {"weeks": 13}, {"category": "strength"}, {"day_of_week": 7}):
        response = await client.get(DEFAULTS, params=params, headers=auth_headers)
        assert response.status_code == 422, params

    assert (await client.get(DEFAULTS)).status_code == 401


def test_effort_level_and_rpe_round_trip():
    assert [level_to_rpe(level) for level in range(1, 6)] == [2, 3, 5, 7, 9]
    assert [rpe_to_level(level_to_rpe(level)) for level in range(1, 6)] == [1, 2, 3, 4, 5]
    assert [rpe_to_level(rpe) for rpe in range(1, 11)] == [1, 1, 2, 3, 3, 4, 4, 5, 5, 5]


def test_seasons():
    assert [season_of(date(2026, month, 1)) for month in range(1, 13)] == [
        "winter",
        "winter",
        "winter",
        "winter",
        "summer",
        "summer",
        "summer",
        "summer",
        "summer",
        "winter",
        "winter",
        "winter",
    ]
