import asyncio
import os
import subprocess
import sys
from uuid import uuid4

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select

from app.database import create_engine, get_session, get_session_maker
from app.models import (
    AccountToken,
    BodyMetric,
    Exercise,
    Food,
    MealEntry,
    NutritionPlan,
    Program,
    ScheduledWorkout,
    SleepEntry,
    StepCount,
    User,
    UserSession,
    UserSettings,
    WorkoutLog,
    WorkoutPlan,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest_asyncio.fixture
async def migrated_client(tmp_path):
    database_path = tmp_path / "account-isolation.db"
    database_url = f"sqlite+aiosqlite:///{database_path}"
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    await asyncio.to_thread(
        subprocess.run,
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        check=True,
        cwd=REPO_ROOT,
        env=environment,
        capture_output=True,
        text=True,
    )

    engine = create_engine(database_url)
    session_maker = get_session_maker(engine)

    async def override_get_session():
        async with session_maker() as session:
            yield session

    from app.main import app

    app.dependency_overrides[get_session] = override_get_session
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://testserver",
    ) as client:
        yield client, engine
    app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


async def _create_logged_in_user(client, admin_headers, email: str) -> dict[str, str]:
    invite = await client.post(
        "/api/v1/invites",
        json={"email": email, "role": "user"},
        headers=admin_headers,
    )
    assert invite.status_code == 201
    accepted = await client.post(
        "/api/v1/auth/invites/accept",
        json={"token": invite.json()["token"], "password": "correct horse battery staple"},
    )
    assert accepted.status_code == 201
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "correct horse battery staple"},
    )
    assert login.status_code == 200
    return {"Cookie": f"wl_session={login.cookies['wl_session']}"}


async def _delete_test_users(engine, test_run_id: str) -> None:
    session_maker = get_session_maker(engine)
    async with session_maker() as session:
        user_ids = list(
            (
                await session.scalars(select(User.id).where(User.email.like(f"%{test_run_id}%")))
            ).all()
        )
        if user_ids:
            await session.execute(delete(UserSession).where(UserSession.user_id.in_(user_ids)))
            await session.execute(delete(AccountToken).where(AccountToken.user_id.in_(user_ids)))
            await session.execute(delete(UserSettings).where(UserSettings.owner_id.in_(user_ids)))
            await session.execute(delete(User).where(User.id.in_(user_ids)))
            await session.commit()
            remaining_settings = await session.scalar(
                select(func.count())
                .select_from(UserSettings)
                .where(UserSettings.owner_id.in_(user_ids))
            )
            assert remaining_settings == 0
        remaining = await session.scalar(
            select(func.count()).select_from(User).where(User.email.like(f"%{test_run_id}%"))
        )
    assert remaining == 0


async def test_workout_plans_are_private_per_invited_account(migrated_client, auth_headers):
    client, app_engine = migrated_client
    test_run_id = uuid4().hex
    owner_cookies = None
    other_cookies = None
    plan_id = None
    other_plan_id = None
    log_id = None
    metric_id = None
    other_metric_id = None
    sleep_id = None
    session_id = None
    scheduled_id = None
    step_ids = []
    program_id = None
    nutrition_plan_id = None
    exercise_id = None
    shared_exercise_id = None
    food_id = None
    bootstrap_food_id = None
    meal_id = None

    try:
        owner_cookies = await _create_logged_in_user(
            client, auth_headers, f"owner-{test_run_id}@example.test"
        )
        other_cookies = await _create_logged_in_user(
            client, auth_headers, f"other-{test_run_id}@example.test"
        )
        created = await client.post(
            "/api/v1/plans",
            json={
                "name": f"Private plan {test_run_id}",
                "description": f"[TEST_RUN_ID:{test_run_id}]",
                "exercises": [
                    {
                        "exercise_name": f"Squat {test_run_id}",
                        "target_sets": 1,
                        "target_reps_min": 5,
                        "target_reps_max": 5,
                    }
                ],
            },
            headers=owner_cookies,
        )
        assert created.status_code == 201
        plan_id = created.json()["id"]

        other_created = await client.post(
            "/api/v1/plans",
            json={"name": f"Private plan {test_run_id}", "exercises": []},
            headers=other_cookies,
        )
        assert other_created.status_code == 201
        other_plan_id = other_created.json()["id"]

        other_list = await client.get("/api/v1/plans", headers=other_cookies)
        assert other_list.status_code == 200
        assert other_list.json()["total"] == 1
        assert all(item["id"] != plan_id for item in other_list.json()["items"])
        assert other_list.json()["items"][0]["id"] == other_plan_id

        other_detail = await client.get(f"/api/v1/plans/{plan_id}", headers=other_cookies)
        assert other_detail.status_code == 404

        started = await client.post(
            "/api/v1/workout-sessions",
            json={"source_plan_id": plan_id},
            headers=owner_cookies,
        )
        assert started.status_code == 201
        session_id = started.json()["id"]
        other_session = await client.get(
            f"/api/v1/workout-sessions/{session_id}", headers=other_cookies
        )
        assert other_session.status_code == 404

        scheduled = await client.post(
            "/api/v1/scheduled-workouts",
            json={"workout_plan_id": plan_id, "scheduled_date": "2026-10-14"},
            headers=owner_cookies,
        )
        assert scheduled.status_code == 201
        scheduled_id = scheduled.json()["id"]
        other_schedule = await client.get(
            f"/api/v1/scheduled-workouts/{scheduled_id}", headers=other_cookies
        )
        assert other_schedule.status_code == 404

        created_log = await client.post(
            "/api/v1/logs",
            json={
                "performed_at": "2026-10-13T08:00:00Z",
                "total_time_minutes": 45,
                "overall_feeling": 4,
                "notes": f"[TEST_RUN_ID:{test_run_id}] private history",
                "exercises": [
                    {
                        "exercise_name": f"Squat {test_run_id}",
                        "sets_count": 1,
                        "reps_per_set": [5],
                        "weight_kg": 100,
                        "rest_time_seconds": 60,
                    }
                ],
            },
            headers=owner_cookies,
        )
        assert created_log.status_code == 201
        log_id = created_log.json()["id"]

        owner_stats = await client.get(
            "/api/v1/exercise-stats",
            params={"name": f"Squat {test_run_id}"},
            headers=owner_cookies,
        )
        assert owner_stats.status_code == 200
        assert owner_stats.json()["items"][0]["sessions_count"] == 1
        other_stats = await client.get(
            "/api/v1/exercise-stats",
            params={"name": f"Squat {test_run_id}"},
            headers=other_cookies,
        )
        assert other_stats.status_code == 200
        assert other_stats.json()["items"][0]["sessions_count"] == 0
        assert other_stats.json()["items"][0]["best_weight_kg"] is None

        other_logs = await client.get("/api/v1/logs", headers=other_cookies)
        assert other_logs.status_code == 200
        assert other_logs.json()["total"] == 0
        assert all(item["id"] != log_id for item in other_logs.json()["items"])
        other_log = await client.get(f"/api/v1/logs/{log_id}", headers=other_cookies)
        assert other_log.status_code == 404

        ingested_metric = await client.post(
            "/api/v1/ingest/weight",
            json={
                "measured_at": "2026-10-13T08:00:00Z",
                "weight_kg": 72.5,
                "source": "test",
                "external_id": test_run_id,
            },
            headers=owner_cookies,
        )
        assert ingested_metric.status_code == 201
        metric_id = ingested_metric.json()["id"]
        other_ingested_metric = await client.post(
            "/api/v1/ingest/weight",
            json={
                "measured_at": "2026-10-13T09:00:00Z",
                "weight_kg": 64.5,
                "source": "test",
                "external_id": test_run_id,
            },
            headers=other_cookies,
        )
        assert other_ingested_metric.status_code == 201
        other_metric_id = other_ingested_metric.json()["id"]
        other_metrics = await client.get("/api/v1/body-metrics", headers=other_cookies)
        assert other_metrics.status_code == 200
        assert [item["id"] for item in other_metrics.json()["items"]] == [other_metric_id]

        owner_steps = await client.post(
            "/api/v1/ingest/steps",
            json={
                "recorded_date": "2026-10-13",
                "steps": 8500,
                "source": "test",
                "external_id": test_run_id,
            },
            headers=owner_cookies,
        )
        assert owner_steps.status_code == 201
        step_ids.append(owner_steps.json()["id"])
        other_steps = await client.post(
            "/api/v1/ingest/steps",
            json={
                "recorded_date": "2026-10-13",
                "steps": 4200,
                "source": "test",
                "external_id": test_run_id,
            },
            headers=other_cookies,
        )
        assert other_steps.status_code == 201
        step_ids.append(other_steps.json()["id"])

        created_sleep = await client.post(
            "/api/v1/sleep-entries",
            json={
                "sleep_start": "2026-10-13T00:00:00Z",
                "sleep_end": "2026-10-13T08:00:00Z",
                "timezone": "Europe/Prague",
                "notes": f"[TEST_RUN_ID:{test_run_id}] private sleep",
            },
            headers=owner_cookies,
        )
        assert created_sleep.status_code == 201
        sleep_id = created_sleep.json()["id"]
        other_sleep = await client.get("/api/v1/sleep-entries", headers=other_cookies)
        assert other_sleep.status_code == 200
        assert all(item["id"] != sleep_id for item in other_sleep.json()["items"])

        created_program = await client.post(
            "/api/v1/programs",
            json={
                "name": f"Private program {test_run_id}",
                "kind": "strength",
                "start_date": "2026-10-01",
                "notes": f"[TEST_RUN_ID:{test_run_id}]",
            },
            headers=owner_cookies,
        )
        assert created_program.status_code == 201
        program_id = created_program.json()["id"]
        other_programs = await client.get("/api/v1/programs", headers=other_cookies)
        assert all(item["id"] != program_id for item in other_programs.json()["items"])

        created_nutrition_plan = await client.post(
            "/api/v1/nutrition-plans",
            json={
                "name": f"Private nutrition {test_run_id}",
                "valid_from": "2026-10-01",
                "energy_target_kcal": 2000,
                "protein_target_g": 120,
                "carbohydrate_target_g": 200,
                "fat_target_g": 60,
            },
            headers=owner_cookies,
        )
        assert created_nutrition_plan.status_code == 201
        nutrition_plan_id = created_nutrition_plan.json()["id"]
        other_nutrition_plans = await client.get("/api/v1/nutrition-plans", headers=other_cookies)
        assert all(
            item["id"] != nutrition_plan_id for item in other_nutrition_plans.json()["items"]
        )

        created_exercise = await client.post(
            "/api/v1/exercises",
            json={
                "name": f"Private exercise {test_run_id}",
                "aliases": [],
                "primary_muscles": ["chest"],
                "secondary_muscles": [],
                "instructions": [],
            },
            headers=owner_cookies,
        )
        assert created_exercise.status_code == 201
        exercise_id = created_exercise.json()["id"]
        shared_exercise = await client.post(
            "/api/v1/exercises",
            json={
                "name": f"Shared template {test_run_id}",
                "aliases": [],
                "primary_muscles": ["back"],
                "secondary_muscles": [],
                "instructions": [],
            },
            headers=auth_headers,
        )
        assert shared_exercise.status_code == 201
        shared_exercise_id = shared_exercise.json()["id"]
        # Search by run id: the shared catalogue is larger than one page, and the
        # query matches both entries, so only account scoping can hide the private one.
        other_exercises = await client.get(
            "/api/v1/exercises", params={"q": test_run_id}, headers=other_cookies
        )
        assert [item["id"] for item in other_exercises.json()["items"]] == [shared_exercise_id]
        assert other_exercises.json()["total"] == 1
        owner_install = await client.post(
            "/api/v1/program-templates/local-gym-ab/install",
            json={"start_date": "2026-10-20"},
            headers=owner_cookies,
        )
        assert owner_install.status_code == 201
        other_programs = await client.get("/api/v1/programs", headers=other_cookies)
        assert all(
            item["id"] != owner_install.json()["program"]["id"]
            for item in other_programs.json()["items"]
        )
        other_plans = await client.get("/api/v1/plans?limit=100", headers=other_cookies)
        assert all(
            item["id"] not in owner_install.json()["plan_ids"]
            for item in other_plans.json()["items"]
        )
        blocked_edit = await client.put(
            f"/api/v1/exercises/{shared_exercise_id}",
            json={
                "name": f"Changed shared template {test_run_id}",
                "aliases": [],
                "primary_muscles": ["back"],
                "secondary_muscles": [],
                "instructions": [],
            },
            headers=other_cookies,
        )
        assert blocked_edit.status_code == 404

        created_food = await client.post(
            "/api/v1/foods",
            json={
                "name": f"Private food {test_run_id}",
                "serving_quantity": 100,
                "serving_unit": "g",
                "energy_kcal": 100,
                "protein_g": 10,
                "carbohydrate_g": 10,
                "fat_g": 3,
            },
            headers=owner_cookies,
        )
        assert created_food.status_code == 201
        food_id = created_food.json()["id"]
        other_foods = await client.get("/api/v1/foods", headers=other_cookies)
        assert all(item["id"] != food_id for item in other_foods.json()["items"])

        bootstrap_food = await client.post(
            "/api/v1/foods",
            json={
                "name": f"Bootstrap-only food {test_run_id}",
                "serving_quantity": 100,
                "serving_unit": "g",
                "energy_kcal": 200,
                "protein_g": 20,
                "carbohydrate_g": 20,
                "fat_g": 5,
            },
            headers=auth_headers,
        )
        assert bootstrap_food.status_code == 201
        bootstrap_food_id = bootstrap_food.json()["id"]
        other_foods = await client.get("/api/v1/foods", headers=other_cookies)
        assert all(item["id"] != bootstrap_food_id for item in other_foods.json()["items"])

        updated_settings = await client.put(
            "/api/v1/settings",
            json={
                "units": "imperial",
                "default_rest_compound_seconds": 100,
                "default_rest_isolation_seconds": 45,
            },
            headers=owner_cookies,
        )
        assert updated_settings.status_code == 200
        other_settings = await client.get("/api/v1/settings", headers=other_cookies)
        assert other_settings.status_code == 200
        assert other_settings.json()["units"] == "metric"
        assert other_settings.json()["default_rest_compound_seconds"] == 90

        created_meal = await client.post(
            "/api/v1/meal-entries",
            json={
                "consumed_at": "2026-10-13T10:00:00Z",
                "meal_type": "breakfast",
                "notes": f"[TEST_RUN_ID:{test_run_id}] private meal",
                "items": [
                    {
                        "quantity": 1,
                        "unit": "serving",
                        "food_name_snapshot": "Private oatmeal",
                        "energy_kcal": 140,
                        "protein_g": 5,
                        "carbohydrate_g": 25,
                        "fat_g": 3,
                        "fiber_g": 4,
                    }
                ],
            },
            headers=owner_cookies,
        )
        assert created_meal.status_code == 201
        meal_id = created_meal.json()["id"]
        other_meals = await client.get("/api/v1/meal-entries", headers=other_cookies)
        assert all(item["id"] != meal_id for item in other_meals.json()["items"])
        owner_daily = await client.get(
            "/api/v1/nutrition/daily?date=2026-10-13", headers=owner_cookies
        )
        other_daily = await client.get(
            "/api/v1/nutrition/daily?date=2026-10-13", headers=other_cookies
        )
        assert owner_daily.json()["totals"]["energy_kcal"] == 140
        assert other_daily.json()["totals"]["energy_kcal"] == 0

        other_export = await client.get("/api/v1/export", headers=other_cookies)
        assert other_export.status_code == 200
        assert all(row["id"] != plan_id for row in other_export.json()["plans"])
        assert other_export.json()["plans"][0]["id"] == other_plan_id
        assert all(row["id"] != log_id for row in other_export.json()["sessions"])
        assert all(row["id"] != metric_id for row in other_export.json()["body_metrics"])
        assert all(row["id"] != sleep_id for row in other_export.json()["sleep_entries"])
        assert [row["id"] for row in other_export.json()["step_counts"]] == [step_ids[1]]

        bootstrap_plans = await client.get("/api/v1/plans", headers=auth_headers)
        assert {row["id"] for row in bootstrap_plans.json()["items"]} >= {
            plan_id,
            other_plan_id,
        }
    finally:
        if step_ids:
            async with app_engine.begin() as connection:
                await connection.execute(delete(StepCount).where(StepCount.id.in_(step_ids)))
                remaining_steps = await connection.scalar(
                    select(func.count()).select_from(StepCount).where(StepCount.id.in_(step_ids))
                )
            assert remaining_steps == 0
        if scheduled_id is not None:
            deleted_schedule = await client.delete(
                f"/api/v1/scheduled-workouts/{scheduled_id}", headers=owner_cookies
            )
            assert deleted_schedule.status_code == 204
            async with app_engine.connect() as connection:
                remaining_schedule = await connection.scalar(
                    select(func.count())
                    .select_from(ScheduledWorkout)
                    .where(ScheduledWorkout.id == scheduled_id)
                )
            assert remaining_schedule == 0
        if meal_id is not None:
            deleted_meal = await client.delete(
                f"/api/v1/meal-entries/{meal_id}", headers=owner_cookies
            )
            assert deleted_meal.status_code == 204
            async with app_engine.connect() as connection:
                remaining_meal = await connection.scalar(
                    select(func.count()).select_from(MealEntry).where(MealEntry.id == meal_id)
                )
            assert remaining_meal == 0
        if food_id is not None:
            deleted_food = await client.delete(f"/api/v1/foods/{food_id}", headers=owner_cookies)
            assert deleted_food.status_code == 204
            async with app_engine.connect() as connection:
                remaining_food = await connection.scalar(
                    select(func.count()).select_from(Food).where(Food.id == food_id)
                )
            assert remaining_food == 0
        if bootstrap_food_id is not None:
            deleted_bootstrap_food = await client.delete(
                f"/api/v1/foods/{bootstrap_food_id}", headers=auth_headers
            )
            assert deleted_bootstrap_food.status_code == 204
            async with app_engine.connect() as connection:
                remaining_bootstrap_food = await connection.scalar(
                    select(func.count()).select_from(Food).where(Food.id == bootstrap_food_id)
                )
            assert remaining_bootstrap_food == 0
        if shared_exercise_id is not None:
            deleted_shared_exercise = await client.delete(
                f"/api/v1/exercises/{shared_exercise_id}", headers=auth_headers
            )
            assert deleted_shared_exercise.status_code == 204
        if exercise_id is not None:
            deleted_exercise = await client.delete(
                f"/api/v1/exercises/{exercise_id}", headers=owner_cookies
            )
            assert deleted_exercise.status_code == 204
            async with app_engine.connect() as connection:
                remaining_exercise = await connection.scalar(
                    select(func.count()).select_from(Exercise).where(Exercise.id == exercise_id)
                )
            assert remaining_exercise == 0
        if nutrition_plan_id is not None:
            deleted_nutrition_plan = await client.delete(
                f"/api/v1/nutrition-plans/{nutrition_plan_id}", headers=owner_cookies
            )
            assert deleted_nutrition_plan.status_code == 204
            async with app_engine.connect() as connection:
                remaining_nutrition_plan = await connection.scalar(
                    select(func.count())
                    .select_from(NutritionPlan)
                    .where(NutritionPlan.id == nutrition_plan_id)
                )
            assert remaining_nutrition_plan == 0
        if program_id is not None:
            deleted_program = await client.delete(
                f"/api/v1/programs/{program_id}", headers=owner_cookies
            )
            assert deleted_program.status_code == 204
            async with app_engine.connect() as connection:
                remaining_program = await connection.scalar(
                    select(func.count()).select_from(Program).where(Program.id == program_id)
                )
            assert remaining_program == 0
        if session_id is not None:
            deleted_session = await client.delete(
                f"/api/v1/workout-sessions/{session_id}", headers=owner_cookies
            )
            assert deleted_session.status_code == 204
        if sleep_id is not None:
            deleted_sleep = await client.delete(
                f"/api/v1/sleep-entries/{sleep_id}", headers=owner_cookies
            )
            assert deleted_sleep.status_code == 204
            async with app_engine.connect() as connection:
                remaining_sleep = await connection.scalar(
                    select(func.count()).select_from(SleepEntry).where(SleepEntry.id == sleep_id)
                )
            assert remaining_sleep == 0
        if metric_id is not None:
            deleted_metric = await client.delete(
                f"/api/v1/body-metrics/{metric_id}", headers=owner_cookies
            )
            assert deleted_metric.status_code == 204
            async with app_engine.connect() as connection:
                remaining_metric = await connection.scalar(
                    select(func.count()).select_from(BodyMetric).where(BodyMetric.id == metric_id)
                )
            assert remaining_metric == 0
        if other_metric_id is not None:
            deleted_other_metric = await client.delete(
                f"/api/v1/body-metrics/{other_metric_id}", headers=other_cookies
            )
            assert deleted_other_metric.status_code == 204
            async with app_engine.connect() as connection:
                remaining_other_metric = await connection.scalar(
                    select(func.count())
                    .select_from(BodyMetric)
                    .where(BodyMetric.id == other_metric_id)
                )
            assert remaining_other_metric == 0
        if log_id is not None:
            deleted_log = await client.delete(f"/api/v1/logs/{log_id}", headers=auth_headers)
            assert deleted_log.status_code == 204
            async with app_engine.connect() as connection:
                remaining_log = await connection.scalar(
                    select(func.count()).select_from(WorkoutLog).where(WorkoutLog.id == log_id)
                )
            assert remaining_log == 0
        if plan_id is not None:
            deleted = await client.delete(f"/api/v1/plans/{plan_id}", headers=auth_headers)
            assert deleted.status_code == 204
            async with app_engine.connect() as connection:
                remaining = await connection.scalar(
                    select(func.count()).select_from(WorkoutPlan).where(WorkoutPlan.id == plan_id)
                )
            assert remaining == 0
        if other_plan_id is not None:
            deleted_other_plan = await client.delete(
                f"/api/v1/plans/{other_plan_id}", headers=other_cookies
            )
            assert deleted_other_plan.status_code == 204
            async with app_engine.connect() as connection:
                remaining_other_plan = await connection.scalar(
                    select(func.count())
                    .select_from(WorkoutPlan)
                    .where(WorkoutPlan.id == other_plan_id)
                )
            assert remaining_other_plan == 0
        await _delete_test_users(app_engine, test_run_id)


async def test_locations_are_private_per_invited_account(migrated_client, auth_headers):
    client, app_engine = migrated_client
    test_run_id = uuid4().hex
    owner_cookies = None
    location_id = None
    try:
        owner_cookies = await _create_logged_in_user(
            client, auth_headers, f"owner-{test_run_id}@example.test"
        )
        other_cookies = await _create_logged_in_user(
            client, auth_headers, f"other-{test_run_id}@example.test"
        )
        created = await client.post(
            "/api/v1/locations",
            json={"name": "Office", "kind": "office", "equipment": ["dumbbell"]},
            headers=owner_cookies,
        )
        assert created.status_code == 201
        location_id = created.json()["id"]

        # The same name is free for another account.
        other_created = await client.post(
            "/api/v1/locations",
            json={"name": "Office", "kind": "office"},
            headers=other_cookies,
        )
        assert other_created.status_code == 201
        other_list = await client.get("/api/v1/locations", headers=other_cookies)
        assert [item["id"] for item in other_list.json()["items"]] == [other_created.json()["id"]]
        other_detail = await client.get(f"/api/v1/locations/{location_id}", headers=other_cookies)
        assert other_detail.status_code == 404
        other_delete = await client.delete(
            f"/api/v1/locations/{location_id}", headers=other_cookies
        )
        assert other_delete.status_code == 404
        other_filter = await client.get(
            f"/api/v1/exercises?location_id={location_id}", headers=other_cookies
        )
        assert other_filter.status_code == 404
        deleted_own = await client.delete(
            f"/api/v1/locations/{other_created.json()['id']}", headers=other_cookies
        )
        assert deleted_own.status_code == 204
    finally:
        if location_id and owner_cookies:
            await client.delete(f"/api/v1/locations/{location_id}", headers=owner_cookies)
        await _delete_test_users(app_engine, test_run_id)
