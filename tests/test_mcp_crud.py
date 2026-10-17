"""Everything the app lets you log can be added, changed and removed over MCP.

Each test drives one kind of record through the MCP server only (add, edit,
remove) and reads it back through the REST API, so a pass means the agent's
write landed in the same rows the app shows.
"""

import pytest

from tests.conftest import mint_mcp_oauth_token
from tests.test_mcp_server import mcp_client


async def _rest_ids(client, auth_headers, path: str) -> list[str]:
    response = await client.get(path, headers=auth_headers)
    assert response.status_code == 200
    return [item["id"] for item in response.json()["items"]]


async def test_sleep_add_edit_remove(client, auth_headers):
    async with mcp_client(mint_mcp_oauth_token()) as agent:
        created = await agent.call_tool(
            "log_sleep",
            {
                "sleep_start": "2026-06-01T21:30:00Z",
                "sleep_end": "2026-06-02T05:30:00Z",
                "timezone": "Europe/Prague",
                "quality_score": 3,
            },
        )
        entry_id = created.data["id"]
        assert created.data["time_in_bed_seconds"] == 8 * 3600

        updated = await agent.call_tool(
            "update_sleep",
            {"sleep_entry_id": entry_id, "quality_score": 5, "notes": "Slept well"},
        )
        assert updated.data["quality_score"] == 5
        assert updated.data["notes"] == "Slept well"
        # Fields the edit did not name keep their value.
        assert updated.data["timezone"] == "Europe/Prague"

        listed = await agent.call_tool("list_sleep", {})
        assert [item["id"] for item in listed.data["items"]] == [entry_id]

    rest = await client.get(f"/api/v1/sleep-entries/{entry_id}", headers=auth_headers)
    assert rest.json()["quality_score"] == 5

    async with mcp_client(mint_mcp_oauth_token()) as agent:
        removed = await agent.call_tool("delete_sleep", {"sleep_entry_id": entry_id})
        assert removed.data == {"deleted": True, "id": entry_id}
    assert await _rest_ids(client, auth_headers, "/api/v1/sleep-entries") == []


async def test_weight_add_edit_remove(client, auth_headers):
    async with mcp_client(mint_mcp_oauth_token()) as agent:
        created = await agent.call_tool(
            "log_biometrics",
            {"measured_at": "2026-06-02T07:00:00Z", "weight_kg": 82.4, "waist_cm": 90.0},
        )
        metric_id = created.data["id"]

        updated = await agent.call_tool(
            "update_biometrics", {"body_metric_id": metric_id, "weight_kg": 81.9}
        )
        assert updated.data["weight_kg"] == 81.9
        assert updated.data["waist_cm"] == 90.0

        listed = await agent.call_tool("list_biometrics", {})
        assert [item["id"] for item in listed.data["items"]] == [metric_id]

    rest = await client.get(f"/api/v1/body-metrics/{metric_id}", headers=auth_headers)
    assert rest.json()["weight_kg"] == 81.9

    async with mcp_client(mint_mcp_oauth_token()) as agent:
        await agent.call_tool("delete_biometrics", {"body_metric_id": metric_id})
    assert await _rest_ids(client, auth_headers, "/api/v1/body-metrics") == []


async def test_food_add_edit_remove(client, auth_headers):
    async with mcp_client(mint_mcp_oauth_token()) as agent:
        created = await agent.call_tool(
            "create_food",
            {
                "name": "Skyr",
                "serving_quantity": 100,
                "serving_unit": "g",
                "energy_kcal": 63,
                "protein_g": 11,
                "carbohydrate_g": 4,
                "fat_g": 0.2,
            },
        )
        food_id = created.data["id"]

        updated = await agent.call_tool(
            "update_food", {"food_id": food_id, "brand": "Milko", "protein_g": 12}
        )
        assert updated.data["brand"] == "Milko"
        assert updated.data["protein_g"] == 12
        assert updated.data["energy_kcal"] == 63

        found = await agent.call_tool("list_foods", {"q": "skyr"})
        assert [item["id"] for item in found.data["items"]] == [food_id]

    rest = await client.get(f"/api/v1/foods/{food_id}", headers=auth_headers)
    assert rest.json()["brand"] == "Milko"

    async with mcp_client(mint_mcp_oauth_token()) as agent:
        await agent.call_tool("delete_food", {"food_id": food_id})
    gone = await client.get(f"/api/v1/foods/{food_id}", headers=auth_headers)
    assert gone.status_code == 404


async def test_meal_add_edit_remove(client, auth_headers):
    food = await client.post(
        "/api/v1/foods",
        json={
            "name": "Oats",
            "serving_quantity": 100,
            "serving_unit": "g",
            "energy_kcal": 380,
            "protein_g": 13,
            "carbohydrate_g": 60,
            "fat_g": 7,
        },
        headers=auth_headers,
    )
    food_id = food.json()["id"]

    async with mcp_client(mint_mcp_oauth_token()) as agent:
        created = await agent.call_tool(
            "log_meal",
            {
                "consumed_at": "2026-06-02T06:30:00Z",
                "meal_type": "breakfast",
                "items": [{"food_id": food_id, "quantity": 50}],
            },
        )
        meal_id = created.data["id"]

        # Changing only the meal's header keeps its items and their food link.
        moved = await agent.call_tool(
            "update_meal", {"meal_entry_id": meal_id, "meal_type": "snack", "notes": "Late"}
        )
        assert moved.data["meal_type"] == "snack"
        assert moved.data["notes"] == "Late"
        assert [(i["food_id"], i["quantity"]) for i in moved.data["items"]] == [(food_id, 50)]

        # Sending items replaces them.
        resized = await agent.call_tool(
            "update_meal",
            {
                "meal_entry_id": meal_id,
                "items": [
                    {"food_id": food_id, "quantity": 80},
                    {
                        "food_name_snapshot": "Banana",
                        "quantity": 1,
                        "unit": "piece",
                        "energy_kcal": 105,
                        "protein_g": 1.3,
                        "carbohydrate_g": 27,
                        "fat_g": 0.4,
                    },
                ],
            },
        )
        assert resized.data["meal_type"] == "snack"
        assert [i["food_name_snapshot"] for i in resized.data["items"]] == ["Oats", "Banana"]
        assert resized.data["items"][0]["energy_kcal_snapshot"] == 304

        listed = await agent.call_tool("list_meals", {})
        assert [item["id"] for item in listed.data["items"]] == [meal_id]

    rest = await client.get(f"/api/v1/meal-entries/{meal_id}", headers=auth_headers)
    assert len(rest.json()["items"]) == 2

    async with mcp_client(mint_mcp_oauth_token()) as agent:
        await agent.call_tool("delete_meal", {"meal_entry_id": meal_id})
    assert await _rest_ids(client, auth_headers, "/api/v1/meal-entries") == []


async def test_past_workout_add_edit_remove(client, auth_headers):
    async with mcp_client(mint_mcp_oauth_token()) as agent:
        created = await agent.call_tool(
            "log_workout",
            {
                "performed_at": "2026-06-03T17:00:00Z",
                "total_time_minutes": 35,
                "overall_feeling": 4,
                "exercises": [
                    {
                        "exercise_name": "Goblet Squat",
                        "sets_count": 3,
                        "reps_per_set": [10, 10, 8],
                        "weight_kg": 24,
                    }
                ],
            },
        )
        log_id = created.data["id"]

        updated = await agent.call_tool(
            "update_workout", {"workout_log_id": log_id, "overall_feeling": 2, "notes": "Tired"}
        )
        assert updated.data["overall_feeling"] == 2
        assert updated.data["notes"] == "Tired"
        assert updated.data["exercises"][0]["reps_per_set"] == [10, 10, 8]

        listed = await agent.call_tool("list_workouts", {})
        assert [item["id"] for item in listed.data["items"]] == [log_id]

    rest = await client.get(f"/api/v1/logs/{log_id}", headers=auth_headers)
    assert rest.json()["notes"] == "Tired"

    async with mcp_client(mint_mcp_oauth_token()) as agent:
        await agent.call_tool("delete_workout", {"workout_log_id": log_id})
    assert await _rest_ids(client, auth_headers, "/api/v1/logs") == []


async def test_activity_add_edit_remove(client, auth_headers):
    """Hockey, swims, rides and hikes are workout logs with an activity_type."""
    async with mcp_client(mint_mcp_oauth_token()) as agent:
        created = await agent.call_tool(
            "log_workout",
            {
                "performed_at": "2026-06-04T19:00:00Z",
                "activity_type": "ice_hockey",
                "total_time_minutes": 75,
                "overall_feeling": 4,
                "effort_rpe": 8,
            },
        )
        log_id = created.data["id"]
        assert created.data["activity_type"] == "ice_hockey"

        updated = await agent.call_tool(
            "update_workout",
            {"workout_log_id": log_id, "activity_type": "cycling", "distance_km": 32.5},
        )
        assert updated.data["activity_type"] == "cycling"
        assert updated.data["distance_km"] == 32.5
        assert updated.data["effort_rpe"] == 8

        await agent.call_tool("delete_workout", {"workout_log_id": log_id})
    assert await _rest_ids(client, auth_headers, "/api/v1/logs") == []


async def test_live_workout_sets_add_edit_remove_then_finish(client, auth_headers):
    plan = await client.post(
        "/api/v1/plans",
        json={
            "name": "Office Strength",
            "exercises": [
                {
                    "exercise_name": "Push-up",
                    "target_sets": 2,
                    "target_reps_min": 10,
                    "target_reps_max": 15,
                }
            ],
        },
        headers=auth_headers,
    )
    plan_id = plan.json()["id"]

    async with mcp_client(mint_mcp_oauth_token()) as agent:
        started = await agent.call_tool("start_workout_session", {"workout_plan_id": plan_id})
        session_id = started.data["id"]
        exercise_id = started.data["exercises"][0]["id"]

        active = await agent.call_tool("get_active_workout_session", {})
        assert active.data["id"] == session_id

        logged = await agent.call_tool(
            "log_set",
            {
                "session_id": session_id,
                "session_exercise_id": exercise_id,
                "set_number": 1,
                "reps": 12,
                "client_operation_id": "crud-1",
            },
        )
        entry_id = logged.data["session"]["exercises"][0]["set_entries"][0]["id"]
        await agent.call_tool(
            "log_set",
            {
                "session_id": session_id,
                "session_exercise_id": exercise_id,
                "set_number": 2,
                "reps": 9,
                "client_operation_id": "crud-2",
            },
        )

        edited = await agent.call_tool(
            "update_set", {"session_id": session_id, "set_entry_id": entry_id, "reps": 14}
        )
        sets = edited.data["exercises"][0]["set_entries"]
        assert {s["set_number"]: s["reps"] for s in sets} == {1: 14, 2: 9}

        trimmed = await agent.call_tool(
            "delete_set", {"session_id": session_id, "set_entry_id": entry_id}
        )
        assert [s["set_number"] for s in trimmed.data["exercises"][0]["set_entries"]] == [2]

        finished = await agent.call_tool(
            "complete_workout_session", {"session_id": session_id, "overall_feeling": 4}
        )
        assert finished.data["status"] == "completed"
        log_id = finished.data["workout_log_id"]

    log = await client.get(f"/api/v1/logs/{log_id}", headers=auth_headers)
    assert log.json()["exercises"][0]["reps_per_set"] == [9]


async def test_live_workout_can_be_discarded(client, auth_headers):
    plan = await client.post(
        "/api/v1/plans",
        json={
            "name": "Throwaway",
            "exercises": [
                {
                    "exercise_name": "Row",
                    "target_sets": 1,
                    "target_reps_min": 8,
                    "target_reps_max": 8,
                }
            ],
        },
        headers=auth_headers,
    )
    async with mcp_client(mint_mcp_oauth_token()) as agent:
        started = await agent.call_tool(
            "start_workout_session", {"workout_plan_id": plan.json()["id"]}
        )
        session_id = started.data["id"]
        removed = await agent.call_tool("delete_workout_session", {"session_id": session_id})
        assert removed.data == {"deleted": True, "id": session_id}
        with pytest.raises(Exception):
            await agent.call_tool("get_active_workout_session", {})

    gone = await client.get(f"/api/v1/workout-sessions/{session_id}", headers=auth_headers)
    assert gone.status_code == 404


async def test_edits_are_validated_like_the_app(client, auth_headers):
    """A merged edit is checked with the same rules as the app's own forms."""
    async with mcp_client(mint_mcp_oauth_token()) as agent:
        created = await agent.call_tool(
            "log_sleep",
            {
                "sleep_start": "2026-06-01T22:00:00Z",
                "sleep_end": "2026-06-02T06:00:00Z",
                "timezone": "Europe/Prague",
            },
        )
        with pytest.raises(Exception):
            await agent.call_tool(
                "update_sleep",
                {"sleep_entry_id": created.data["id"], "sleep_end": "2026-06-01T21:00:00Z"},
            )
        with pytest.raises(Exception):
            await agent.call_tool(
                "delete_sleep", {"sleep_entry_id": "00000000-0000-0000-0000-000000000000"}
            )


@pytest.mark.parametrize(
    "tool, arguments",
    [
        ("delete_sleep", {"sleep_entry_id": "00000000-0000-0000-0000-000000000000"}),
        ("delete_meal", {"meal_entry_id": "00000000-0000-0000-0000-000000000000"}),
        ("update_biometrics", {"body_metric_id": "00000000-0000-0000-0000-000000000000"}),
    ],
)
async def test_a_read_only_token_cannot_edit_or_remove(client, auth_headers, tool, arguments):
    async with mcp_client(mint_mcp_oauth_token(scopes=["read"])) as agent:
        tools = {t.name for t in await agent.list_tools()}
        assert tool not in tools
        with pytest.raises(Exception):
            await agent.call_tool(tool, arguments)
