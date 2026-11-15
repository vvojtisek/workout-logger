"""The AI coach loop over REST: profile, readiness, quick logs, meal plans,
supplements, coach prescriptions, baselines and the consolidated context.
Runs the real app against a real temporary SQLite database."""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.services.readiness_score import (
    ReadinessInputs,
    exercise_factor,
    load_factor,
    main_reason,
    readiness_score,
)

TODAY = datetime.now(UTC).date()

PROFILE = {
    "display_name": "Vlad",
    "birth_year": 1973,
    "longevity_goals": ["Keep VO2max high", "Hold lean mass"],
    "dietary_constraints": [
        {
            "item": "fish and seafood",
            "kind": "allergy",
            "severity": "severe",
            "match_terms": ["fish", "salmon", "shrimp", "seafood"],
        },
        {"item": "gluten", "kind": "intolerance", "match_terms": ["gluten", "wheat"]},
        {"item": "lactose", "kind": "intolerance", "match_terms": ["milk", "cheese"]},
        {"item": "mushrooms", "kind": "exclusion"},
        {"item": "cooked dill", "kind": "exclusion", "match_terms": []},
        {"item": "chickpeas", "kind": "exclusion"},
    ],
    "physical_constraints": ["No deep loaded knee flexion"],
}


def _ingredient(name: str, quantity: float, unit: str = "g", **macros: float) -> dict:
    return {"name": name, "quantity": quantity, "unit": unit, **macros}


def _day(plan_date: date, meals: list[dict] | None = None) -> dict:
    return {
        "plan_date": plan_date.isoformat(),
        "energy_target_kcal": 2400,
        "protein_target_g": 160,
        "fiber_target_g": 35,
        "meals": meals
        or [
            {
                "meal_type": "breakfast",
                "name": "Oats with berries",
                "prep_steps": ["Cook oats in water", "Top with berries"],
                "energy_kcal": 450,
                "protein_g": 25,
                "carbohydrate_g": 70,
                "fat_g": 9,
                "fiber_g": 10,
                "ingredients": [
                    _ingredient("Gluten-free oats", 80),
                    _ingredient("Blueberries", 150),
                    _ingredient("Lactose-free milk", 200, "ml"),
                ],
            },
            {
                "meal_type": "dinner",
                "name": "Chicken, rice and greens",
                "prep_steps": ["Grill the chicken", "Steam the broccoli"],
                "energy_kcal": 700,
                "protein_g": 55,
                "carbohydrate_g": 80,
                "fat_g": 15,
                "ingredients": [
                    _ingredient(
                        "Chicken breast",
                        200,
                        energy_kcal=330,
                        protein_g=62,
                        carbohydrate_g=0,
                        fat_g=7,
                    ),
                    _ingredient(
                        "Rice", 90, energy_kcal=320, protein_g=6, carbohydrate_g=70, fat_g=1
                    ),
                    _ingredient(
                        "Blueberries",
                        50,
                        energy_kcal=50,
                        protein_g=1,
                        carbohydrate_g=10,
                        fat_g=0,
                    ),
                ],
            },
        ],
    }


# -- readiness scoring (pure) ------------------------------------------------


def test_fresh_check_in_scores_full_and_keeps_the_load():
    fresh = ReadinessInputs(soreness=1, fatigue=1, sleep_quality=10, prior_day_strain="none")
    assert readiness_score(fresh) == 100
    assert load_factor(100) == 1.0


def test_post_hockey_soreness_cuts_ten_percent_and_names_hockey():
    inputs = ReadinessInputs(soreness=6, fatigue=6, sleep_quality=6, prior_day_strain="high")
    score = readiness_score(inputs)
    assert 45 <= score < 60
    assert load_factor(score) == 0.9
    assert main_reason(inputs, hockey_yesterday=True) == "post-hockey recovery"


def test_missing_components_are_dropped_not_counted_as_zero():
    only_sleep = ReadinessInputs(
        soreness=None, fatigue=None, sleep_quality=10, prior_day_strain="none"
    )
    assert readiness_score(only_sleep) == 100


def test_sore_primary_muscle_takes_an_extra_cut():
    inputs = ReadinessInputs(
        soreness=7,
        fatigue=2,
        sleep_quality=9,
        prior_day_strain="none",
        sore_muscle_groups=("quads",),
    )
    base = load_factor(readiness_score(inputs))
    assert exercise_factor(inputs, {"quads", "glutes"}) == round(base - 0.05, 2)
    assert exercise_factor(inputs, {"chest"}) == base


# -- profile -----------------------------------------------------------------


async def test_profile_starts_empty_and_round_trips(client, auth_headers):
    empty = await client.get("/api/v1/profile", headers=auth_headers)
    assert empty.status_code == 200
    assert empty.json()["dietary_constraints"] == []

    saved = await client.put("/api/v1/profile", json=PROFILE, headers=auth_headers)
    assert saved.status_code == 200
    body = saved.json()
    assert body["dietary_constraints"][0]["severity"] == "severe"
    assert body["dietary_constraints"][3]["match_terms"] is None
    assert body["updated_at"] is not None


# -- readiness and quick logs ------------------------------------------------


async def test_check_in_derives_high_strain_from_yesterdays_hockey(client, auth_headers):
    yesterday = datetime.combine(TODAY - timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    hockey = await client.post(
        "/api/v1/coach/log",
        json={
            "activity": {
                "type": "ice_hockey",
                "performed_at": (yesterday + timedelta(hours=19)).isoformat(),
            }
        },
        headers=auth_headers,
    )
    assert hockey.status_code == 201
    log = hockey.json()["workout_log"]
    assert (log["activity_type"], log["total_time_minutes"], log["effort_rpe"]) == (
        "ice_hockey",
        75,
        8,
    )

    check_in = await client.post(
        "/api/v1/readiness-logs",
        json={"log_date": TODAY.isoformat(), "soreness": 6, "fatigue": 6, "sleep_quality": 6},
        headers=auth_headers,
    )
    assert check_in.status_code == 201
    body = check_in.json()
    assert body["prior_day_strain"] == "high"
    assert body["strain_source"] == "derived"
    assert body["load_factor"] == 0.9
    assert body["source"] == "api"


async def test_swim_sauna_is_one_swim_log_with_defaults(client, auth_headers):
    response = await client.post(
        "/api/v1/coach/log", json={"activity": {"type": "swim_sauna"}}, headers=auth_headers
    )
    assert response.status_code == 201
    log = response.json()["workout_log"]
    assert log["activity_type"] == "swimming"
    assert (log["total_time_minutes"], log["laps"], log["sauna_rounds"]) == (30, 30, 3)
    assert log["source_plan_name"] == "Swim + sauna"


async def test_coach_log_needs_something_and_rolls_back_together(client, auth_headers):
    empty = await client.post("/api/v1/coach/log", json={}, headers=auth_headers)
    assert empty.status_code == 422
    bad = await client.post(
        "/api/v1/coach/log",
        json={"activity": {"type": "running"}, "readiness": {"soreness": 11}},
        headers=auth_headers,
    )
    assert bad.status_code == 422
    logs = await client.get("/api/v1/logs", headers=auth_headers)
    assert logs.json()["total"] == 0


# -- meal plans ----------------------------------------------------------------


async def test_nutrition_plan_builds_shopping_list_and_keeps_checks(client, auth_headers):
    tomorrow = TODAY + timedelta(days=1)
    response = await client.put(
        "/api/v1/coach/nutrition-plan",
        json={
            "days": [_day(TODAY), _day(tomorrow)],
            "supplement_stack": [
                {"name": "Creatine", "dose": 5, "unit": "g", "timing": "morning"},
                {
                    "name": "Vitamin D3",
                    "dose": 2000,
                    "unit": "IU",
                    "timing": "with_meal",
                    "applies_on": "daily",
                },
            ],
        },
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [day["plan_date"] for day in body["days"]] == [
        TODAY.isoformat(),
        tomorrow.isoformat(),
    ]
    today_plan = body["days"][0]
    blueberries = next(
        item for item in today_plan["grocery_items"] if item["name"] == "Blueberries"
    )
    assert blueberries["quantity"] == 200
    assert {item["name"] for item in body["supplements"]} == {"Creatine", "Vitamin D3"}

    week = await client.get(
        "/api/v1/grocery-list",
        params={"start": TODAY.isoformat(), "end": tomorrow.isoformat()},
        headers=auth_headers,
    )
    line = next(item for item in week.json()["items"] if item["name"] == "Blueberries")
    assert line["quantity"] == 400
    assert len(line["item_ids"]) == 2

    checked = await client.patch(
        "/api/v1/grocery-list",
        json={"ids": line["item_ids"], "checked": True},
        headers=auth_headers,
    )
    assert checked.status_code == 204

    # Re-plan today: blueberries stay on the list and stay ticked.
    again = await client.put(
        "/api/v1/coach/nutrition-plan", json={"days": [_day(TODAY)]}, headers=auth_headers
    )
    assert again.status_code == 200
    items = {item["name"]: item for item in again.json()["days"][0]["grocery_items"]}
    assert items["Blueberries"]["checked"] is True
    assert items["Rice"]["checked"] is False
    # Omitting the stack leaves it alone.
    assert {item["name"] for item in again.json()["supplements"]} == {"Creatine", "Vitamin D3"}


async def test_nutrition_plan_rejects_hard_exclusions_and_saves_nothing(client, auth_headers):
    await client.put("/api/v1/profile", json=PROFILE, headers=auth_headers)
    meals = _day(TODAY)["meals"]
    meals[1]["ingredients"].append(_ingredient("Smoked salmon", 50))
    meals[0]["ingredients"].append(_ingredient("Chickpeas", 40))
    response = await client.put(
        "/api/v1/coach/nutrition-plan",
        json={"days": [_day(TODAY, meals)]},
        headers=auth_headers,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "DIETARY_CONSTRAINT_VIOLATION"
    assert "Smoked salmon" in body["detail"] and "Chickpeas" in body["detail"]
    missing = await client.get(f"/api/v1/meal-plans/{TODAY.isoformat()}", headers=auth_headers)
    assert missing.status_code == 404


async def test_free_from_products_and_unenforced_rules_pass(client, auth_headers):
    await client.put("/api/v1/profile", json=PROFILE, headers=auth_headers)
    meals = _day(TODAY)["meals"]
    meals[1]["ingredients"].append(_ingredient("Fresh dill", 5, note="raw, added at the end"))
    response = await client.put(
        "/api/v1/coach/nutrition-plan",
        json={"days": [_day(TODAY, meals)]},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text


async def test_meal_eaten_logs_macros_once_and_undo_removes_them(client, auth_headers):
    plan = await client.put(
        "/api/v1/coach/nutrition-plan", json={"days": [_day(TODAY)]}, headers=auth_headers
    )
    breakfast, dinner = plan.json()["days"][0]["meals"]

    eaten = await client.post(
        f"/api/v1/meal-plans/meals/{dinner['id']}/eaten", headers=auth_headers
    )
    assert eaten.status_code == 200
    entry_id = eaten.json()["meals"][1]["eaten_meal_entry_id"]
    assert entry_id is not None
    repeat = await client.post(
        f"/api/v1/meal-plans/meals/{dinner['id']}/eaten", headers=auth_headers
    )
    assert repeat.json()["meals"][1]["eaten_meal_entry_id"] == entry_id

    entry = (await client.get(f"/api/v1/meal-entries/{entry_id}", headers=auth_headers)).json()
    # Every dinner ingredient had macros, so each became its own item.
    assert sorted(item["food_name_snapshot"] for item in entry["items"]) == [
        "Blueberries",
        "Chicken breast",
        "Rice",
    ]
    await client.post(f"/api/v1/meal-plans/meals/{breakfast['id']}/eaten", headers=auth_headers)
    summary = await client.get(
        "/api/v1/nutrition/daily",
        params={"date": TODAY.isoformat()},
        headers=auth_headers,
    )
    assert summary.status_code == 200, summary.text
    assert summary.json()["totals"]["protein_g"] == pytest.approx(25 + 62 + 6 + 1)

    undone = await client.delete(
        f"/api/v1/meal-plans/meals/{dinner['id']}/eaten", headers=auth_headers
    )
    assert undone.json()["meals"][1]["eaten_meal_entry_id"] is None
    gone = await client.get(f"/api/v1/meal-entries/{entry_id}", headers=auth_headers)
    assert gone.status_code == 404


async def test_kitchen_checklist_marks_ingredients_prepared(client, auth_headers):
    plan = await client.put(
        "/api/v1/coach/nutrition-plan", json={"days": [_day(TODAY)]}, headers=auth_headers
    )
    ingredient = plan.json()["days"][0]["meals"][0]["ingredients"][0]
    response = await client.patch(
        f"/api/v1/meal-plans/ingredients/{ingredient['id']}",
        json={"prepared": True},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["meals"][0]["ingredients"][0]["prepared"] is True


async def test_supplements_due_follow_training_days(client, auth_headers):
    await client.put(
        "/api/v1/coach/nutrition-plan",
        json={
            "days": [_day(TODAY)],
            "supplement_stack": [
                {"name": "Creatine", "dose": 5, "unit": "g", "timing": "morning"},
                {
                    "name": "Electrolytes",
                    "dose": 1,
                    "unit": "serving",
                    "timing": "pre_workout",
                    "applies_on": "hockey_days",
                },
            ],
        },
        headers=auth_headers,
    )
    rest = await client.get(
        "/api/v1/supplements/due", params={"date": TODAY.isoformat()}, headers=auth_headers
    )
    assert [item["supplement"]["name"] for item in rest.json()["items"]] == ["Creatine"]

    await client.post(
        "/api/v1/coach/log", json={"activity": {"type": "ice_hockey"}}, headers=auth_headers
    )
    hockey = await client.get(
        "/api/v1/supplements/due", params={"date": TODAY.isoformat()}, headers=auth_headers
    )
    body = hockey.json()
    assert body["hockey_day"] is True
    names = [item["supplement"]["name"] for item in body["items"]]
    assert names == ["Creatine", "Electrolytes"]

    creatine_id = body["items"][0]["supplement"]["id"]
    taken = await client.put(
        f"/api/v1/supplements/{creatine_id}/intakes/{TODAY.isoformat()}", headers=auth_headers
    )
    assert taken.json()["items"][0]["taken"] is True


# -- coach prescriptions and progression ----------------------------------------


def _bench_log(day: date, weight: float, reps: list[int]) -> dict:
    return {
        "performed_at": datetime.combine(day, datetime.min.time(), tzinfo=UTC)
        .replace(hour=7)
        .isoformat(),
        "total_time_minutes": 40,
        "overall_feeling": 4,
        "exercises": [
            {
                "exercise_name": "Bench Press",
                "sets_count": len(reps),
                "reps_per_set": reps,
                "weight_kg": weight,
            }
        ],
    }


async def test_adaptive_workout_upsert_is_idempotent_and_prefills_the_session(client, auth_headers):
    payload = {
        "scheduled_date": TODAY.isoformat(),
        "name": "Upper A",
        "notes": "Keep 2 RIR",
        "exercises": [
            {
                "exercise_name": "Bench Press",
                "target_sets": 3,
                "target_reps_min": 8,
                "target_weight_kg": 70,
                "target_rir": 2,
                "rationale": "Hold load after hockey",
            },
            {
                "exercise_name": "Plank",
                "exercise_kind": "bodyweight",
                "target_sets": 2,
                "target_reps_min": 45,
            },
        ],
    }
    first = await client.put("/api/v1/coach/workout-plan", json=payload, headers=auth_headers)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["created"] is True
    assert body["plan"]["origin"] == "coach"
    assert body["plan"]["exercises"][0]["target_source"] == "coach"
    assert body["plan"]["exercises"][0]["target_reps_max"] == 8

    payload["exercises"][0]["target_weight_kg"] = 72.5
    second = await client.put("/api/v1/coach/workout-plan", json=payload, headers=auth_headers)
    assert second.json()["created"] is False
    assert second.json()["scheduled_workout"]["id"] == body["scheduled_workout"]["id"]

    user_plans = await client.get("/api/v1/plans", params={"origin": "user"}, headers=auth_headers)
    assert user_plans.json()["total"] == 0

    started = await client.post(
        f"/api/v1/scheduled-workouts/{body['scheduled_workout']['id']}/start",
        headers=auth_headers,
    )
    assert started.status_code in (200, 201), started.text
    bench = started.json()["exercises"][0]
    assert (bench["suggested_weight_kg"], bench["suggested_reps"]) == (72.5, 8)
    assert bench["target_source"] == "coach"
    assert bench["coach_rationale"] == "Hold load after hockey"
    assert bench["suggestion_note"] == "Coach target"

    locked = await client.put("/api/v1/coach/workout-plan", json=payload, headers=auth_headers)
    assert locked.status_code == 409
    assert locked.json()["code"] == "COACH_SESSION_STARTED"


async def test_history_suggestion_is_scaled_by_todays_check_in(client, auth_headers):
    plan = await client.post(
        "/api/v1/plans",
        json={
            "name": "Upper",
            "exercises": [
                {
                    "exercise_name": "Bench Press",
                    "target_sets": 3,
                    "target_reps_min": 6,
                    "target_reps_max": 10,
                }
            ],
        },
        headers=auth_headers,
    )
    for days_ago, reps in ((9, [8, 8, 8]), (5, [8, 8, 8])):
        logged = await client.post(
            "/api/v1/logs",
            json={
                **_bench_log(TODAY - timedelta(days=days_ago), 70, reps),
                "source_plan_id": plan.json()["id"],
            },
            headers=auth_headers,
        )
        assert logged.status_code == 201
    await client.post(
        "/api/v1/coach/log",
        json={
            "readiness": {
                "soreness": 6,
                "fatigue": 6,
                "sleep_quality": 6,
                "prior_day_strain": "high",
            }
        },
        headers=auth_headers,
    )
    baseline = await client.get(
        "/api/v1/coach/exercise-baseline",
        params={"exercise_name": "Bench Press"},
        headers=auth_headers,
    )
    assert baseline.status_code == 200
    body = baseline.json()
    assert [session["reps_per_set"] for session in body["sessions"]] == [[8, 8, 8], [8, 8, 8]]
    assert body["sessions"][0]["e1rm_kg"] == pytest.approx(88.7)
    assert body["readiness"]["load_factor"] == 0.9

    session = await client.post(
        "/api/v1/workout-sessions",
        json={"source_plan_id": plan.json()["id"]},
        headers=auth_headers,
    )
    bench = session.json()["exercises"][0]
    # Same load by the rules (70 kg), then -10% rounded to the 1 kg step.
    assert bench["suggested_weight_kg"] == 63
    assert bench["readiness_factor"] == 0.9
    assert bench["suggestion_note"].startswith("Adjusted -10% for yesterday's hard session")


# -- consolidated context ------------------------------------------------------


async def test_coaching_context_bundles_the_loop(client, auth_headers):
    await client.put("/api/v1/profile", json=PROFILE, headers=auth_headers)
    await client.post(
        "/api/v1/logs",
        json=_bench_log(TODAY - timedelta(days=2), 70, [8, 8, 7]),
        headers=auth_headers,
    )
    await client.post(
        "/api/v1/coach/log",
        json={
            "activity": {"type": "swim_sauna"},
            "readiness": {"log_date": TODAY.isoformat(), "soreness": 3, "sore_muscle_groups": []},
        },
        headers=auth_headers,
    )
    await client.put(
        "/api/v1/coach/nutrition-plan", json={"days": [_day(TODAY)]}, headers=auth_headers
    )

    response = await client.get(
        "/api/v1/coach/context",
        params={"days": 7, "today": TODAY.isoformat()},
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    context = response.json()
    assert context["window"]["days"] == 7
    assert context["profile"]["dietary_constraints"][0]["item"] == "fish and seafood"
    totals = context["training"]["totals"]
    assert (totals["strength_sessions"], totals["swim_sessions"]) == (1, 1)
    trend = context["training"]["exercise_trends"][0]
    assert trend["sessions"][0]["top_set"] == "8/8/7 @ 70 kg"
    assert context["readiness"]["today_score"] is not None
    assert context["nutrition"]["plans"][0]["plan_date"] == TODAY.isoformat()
    assert context["nutrition"]["adherence"][-1]["target_protein_g"] == 160
    assert "readiness" in context["rules"]


async def test_meal_plans_are_private_to_their_owner(client, auth_headers):
    from tests.test_account_data_isolation import _create_logged_in_user

    alice = await _create_logged_in_user(client, auth_headers, "coach-alice@example.test")
    bob = await _create_logged_in_user(client, auth_headers, "coach-bob@example.test")
    plan = await client.put(
        "/api/v1/coach/nutrition-plan", json={"days": [_day(TODAY)]}, headers=alice
    )
    assert plan.status_code == 200
    meal_id = plan.json()["days"][0]["meals"][0]["id"]
    item_id = plan.json()["days"][0]["grocery_items"][0]["id"]

    assert (
        await client.get(f"/api/v1/meal-plans/{TODAY.isoformat()}", headers=bob)
    ).status_code == 404
    assert (
        await client.post(f"/api/v1/meal-plans/meals/{meal_id}/eaten", headers=bob)
    ).status_code == 404
    assert (
        await client.patch(
            "/api/v1/grocery-list", json={"ids": [item_id], "checked": True}, headers=bob
        )
    ).status_code == 404
    # Bob may write his own plan for the same date.
    own = await client.put(
        "/api/v1/coach/nutrition-plan", json={"days": [_day(TODAY)]}, headers=bob
    )
    assert own.status_code == 200
